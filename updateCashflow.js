const {
    MongoClient,
    ObjectID
} = require('mongodb');
const url = "mongodb://127.0.0.1:27017/UnitedPOS";
const moment = require('moment')

MongoClient.connect(url, async(err, db) => {
    err && console.log(err);

    let date = "2017-08-07";
    let today = "2018-01-22";

    // while(date !== today){
    //     console.log("updating",date);
    //     db.collection("transaction").find({date}).toArray((err,transactions)=>{
    //         transactions.forEach(trans=>{
    //             if(trans.type === 'THIRD'){
    //                 trans.actual = parseFloat((trans.paid - trans.tip).toFixed(2))

    //                 db.collection("transaction").save(trans)
    //             }
    //         })
    //     })
    //     date = moment(date, "YYYY-MM-DD").add(1, "days").format("YYYY-MM-DD")
    // }

    while (date !== today) {
        console.log("updating", date)
        db.collection("order").find({
            date
        }).toArray((err, invoices) => {
            console.log("total tickets", invoices.length)
            invoices.forEach(ticket => {
                console.log("update ticket", ticket.number)

                ticket.payment.log.forEach(async(log, index) => {
                    let payType;
                    let paySubtype;
                    switch (log.type) {
                        case "CASH":
                            payType = 'CASH';
                            paySubtype = "";
                            break;
                        case "CREDIT":
                            payType = 'CREDIT';
                            if (log._id) {
                                try {
                                    let r = await db.collection("terminal").findOne({
                                        _id: ObjectID(log._id)
                                    });
                                    paySubtype = r.account.type
                                } catch (e) {
                                    console.log(e);
                                }

                            } else {
                                paySubtype = "";
                            }

                            break;
                        default:
                            payType = 'THIRD';
                            paySubtype = log.type;
                    }
                    let actual = parseFloat(log.paid) - (parseFloat(log.tip) || 0) - (parseFloat(log.change) || 0);
                    let transaction = {
                        _id: ObjectID(),
                        date: ticket.date,
                        time: ticket.time,
                        order: ticket._id.toString(),
                        ticket: {
                            number: ticket.number,
                            type: ticket.type
                        },
                        paid: parseFloat(log.paid),
                        change: parseFloat(log.change) || 0,
                        actual: log.type === 'CREDIT' ? parseFloat(log.paid) : actual,
                        tip: parseFloat(log.tip) || 0,
                        cashier: ticket.cashier,
                        server: ticket.server,
                        cashDrawer: null,
                        station: ticket.station,
                        type: payType,
                        for: "Order",
                        subType: paySubtype,
                        credential: log.id || "",
                        lfd: log.number || null
                    }
                    console.log("update transaction")
                    db.collection("transaction").save(transaction);
                    transaction._id = transaction._id.toString();
                    ticket.payment.log.splice(index, 1, transaction);
                })
                db.collection("order").save(ticket)
            })
        });
        date = moment(date, "YYYY-MM-DD").add(1, "days").format("YYYY-MM-DD")
    }

})