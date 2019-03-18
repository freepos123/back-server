exports = module.exports = (io, db) => {
    io.sockets.on('connection', socket => {
        socket.on("[INVOICE] SAVE", (order, print, sent) => {
            db.collection("order").count({ date: today(), _id: { $ne: ObjectID(order._id) } }).then((count) => {
                order._id = ObjectID(order._id);
                order.number = ++count;
                order.type === 'DELIVERY' && (order.driver = null);
                sent(order);

                print && order.content.forEach(item => {
                    item.print = true;
                    item.pending = false;
                });

                delete order.__creditPayment__;
                order.print = order.content.every(item => item.print);

                db.collection("order").save(order).then(() => {
                    log({
                        eventID: 7000,
                        note: `New order #${order.number} save to database`
                    })

                    if (order.customer._id) {
                        db.collection("customer").findOneAndUpdate({
                            _id: ObjectID(order.customer._id)
                        }, {
                                $inc: { orderCount: 1, orderAmount: order.payment.due }
                            });

                        let date = new Date();
                        date.setMonth(date.getMonth() - 6);
                        db.collection("order").aggregate([{
                            $match: {
                                'customer.phone': order.customer.phone,
                                time: {
                                    $gt: +date
                                }
                            }
                        }, { $project: { 'content._id': 1 } }]).toArray((err, results) => {
                            let counter = {};
                            ([].concat(...results.map(i => i.content))).map(_ => _._id).forEach(id => { counter[id] = (counter[id] || 0) + 1 });

                            const favorite = Object.keys(counter).map(key => [key, counter[key]]).sort((a, b) => a[1] < b[1]).map(id => id[0]).slice(0, 5);

                            db.collection("customer").update({ _id: ObjectID(order.customer._id) }, { $set: { 'favorite': favorite } });
                            log({
                                eventID: 7100,
                                data: {
                                    _id: order.customer._id,
                                    favorite
                                },
                                note: `Update Customer Favorite item`,
                            })
                        })
                    }

                    System.sync = +new Date();
                    io.emit("INSERT_ORDER", {
                        sync: System.sync,
                        number: ++count,
                        order
                    })
                })
            })
        });

        socket.on("[UPDATE] INVOICE", async (order, print) => {
            let tableReset = false;

            order._id = ObjectID(order._id);
            order.content.forEach(item => {
                delete item.new;
                if (print) {
                    item.print = true;
                    item.pending = false;
                }
            });

            order.print = order.content.every(item => item.print);

            if (order.hasOwnProperty("parent")) {
                let logs = await db.collection("transaction").find({ split: order._id.toString() }).toArray();
                let paid = logs.map(i => i.actual).reduce((a, b) => a + b, 0).toPrecision(12).toFloat();

                order.payment.paid = paid;
                order.payment.balance = (order.payment.due + order.payment.gratuity + order.payment.rounding).toPrecision(12).toFloat();
                order.payment.remain = (order.payment.balance - paid).toPrecision(12).toFloat();
                order.settled = order.payment.remain <= 0;

                await db.collection("split").save(order);

                logs = await db.collection("transaction").find({ order: order.parent }).toArray();
                paid = logs.map(i => i.actual).reduce((a, b) => a + b, 0).toPrecision(12).toFloat();

                let _order = await db.collection("order").findOne({ _id: ObjectID(order.parent) });

                _order.payment.log = logs;
                _order.payment.paid = paid;
                _order.payment.balance = (_order.payment.due + _order.payment.gratuity + _order.payment.rounding).toPrecision(12).toFloat();
                _order.payment.remain = (_order.payment.balance - paid).toPrecision(12).toFloat();
                _order.settled = _order.payment.remain <= 0;

                await db.collection("order").save(_order);
            } else {
                const logs = await db.collection("transaction").find({ order: order._id.toString() }).toArray();
                const paid = logs.map(i => i.actual).reduce((a, b) => a + b, 0).toPrecision(12).toFloat();

                order.payment.paid = paid;
                order.payment.balance = (order.payment.due + order.payment.gratuity + order.payment.rounding).toPrecision(12).toFloat();
                order.payment.remain = (order.payment.balance - paid).toPrecision(12).toFloat();
                order.settled = order.payment.remain <= 0;

                await db.collection("order").save(order);

                System.sync = +new Date();
                io.emit("UPDATE_ORDER", { sync: System.sync, order });

                tableReset = order.session && (order.status === 0 || order.settled);
            }

            log({
                eventID: 7101,
                data: order._id.toString(),
                note: `Update exist invoice #${order.number}`
            })


            if (tableReset) {
                const config = await db.collection("config").findOne({}, { dinein: 1 });
                const status = config.dinein.autoClear ? 1 : 4;

                log({
                    eventID: 7102,
                    note: `Update table status due to #${order.number} settled.`
                })

                await db.collection("table").findOneAndUpdate({
                    session: order.session
                }, {
                        $set: {
                            status,
                            session: null,
                            server: null,
                            time: null,
                            invoice: [],
                            guest: 0
                        }
                    });

                const table = await db.collection("table").findOne({ _id: ObjectID(order.tableID) });

                System.sync = +new Date();
                io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table })
            }
        });
    })
}