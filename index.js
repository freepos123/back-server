const { MongoClient, ObjectID } = require('mongodb')
//const exec = require('child_process').exec
const app = require('http').createServer()
const io = require('socket.io')(app)
const Scan = require('./scanner.js')
const request = require("request")
const crypto = require("crypto")
const md5 = require('md5')
const ip = require("ip")
const url = "mongodb://localhost:27017/UnitedPOS";
const moment = require("moment");
const production = false;

var System = {
  version: "0.8.6",
  require: "0.8.6",
  build: 1516988536368,
  support: "(888)299-0524",
  startTime: new Date(),
  sync: +new Date(),
  host: ip.address()
}

var stations = {};

MongoClient.connect(url, (error, db) => {
  if (error) {
    console.log(error);
    return;
  }

  app.listen(8888);

  db.collection("log").save({
    date: today(),
    time: +new Date(),
    operator: "SYSTEM",
    station: "SERVO",
    eventID: 1000,
    source: "server",
    type: "information",
    note: "Server is listen to port 8888."
  });

  db.collection("log").remove({ time: { $lt: +new Date - 2.592e+6 } }, (error, result) => {
    const { n, ok } = result;
    if (error) {
      db.collection("log").save({
        operator: "SYSTEM",
        station: "SERVO",
        eventID: 1100,
        type: "warning",
        note: `Something is wrong when removing old log.\n\nError Message:\n${error}`
      })
    }

    db.collection("log").save({
      operator: "SYSTEM",
      station: "SERVO",
      eventID: 1100,
      note: `Auto remove old logs.\n\nSuccessful removed ${n} records.`
    })
  });

  io.on('connection', socket => {
    socket.emit("CONNECTED", "HOST_CONNECTED");

    socket.on("[INITIAL] POS", () => {
      const date = today();

      Promise.all([
        db.collection("config").findOne({}),
        db.collection("menu").aggregate([{ $addFields: { clickable: true } }, { $sort: { num: 1 } }]).toArray(),
        db.collection("submenu").aggregate([{ $addFields: { clickable: true } }, { $sort: { num: 1 } }]).toArray(),
        db.collection("table").find().toArray(),
        db.collection("request").aggregate([{ $addFields: { clickable: true } }, { $sort: { num: 1 } }]).toArray(),
        db.collection("order").find({ date }).sort({ number: -1 }).toArray(),
        db.collection("reservation").find({ date }).toArray(),
        db.collection("template").find().toArray()]).then(data => {
          const [config, menu, submenu, table, request, orders, reservations, template] = data;
          socket.emit("APP_RUNTIME_CONFIG", { config, menu, submenu, table, orders, request, template, reservations, sync: System.sync })
        });

      log({
        eventID: 1001,
        note: "POS software initial connect to server."
      })
    })

    socket.on("[INITIAL] STATION", async (credential, sent) => {
      const { mac, username } = credential;
      const station = await db.collection("stations").findOne({ mac, username });

      if (station) {
        const { alias } = station;

        socket.station = alias;
        stations[alias] = { alias, mac };

        sent(station);

        log({
          eventID: 1002,
          note: `Servo returns station configuration for MAC: ${mac}.`
        })
      } else {
        sent(undefined);

        log({
          eventID: 1003,
          type: "warning",
          note: `Servo unable to find configuration for station. ( MAC:${mac} )\nThis probably a new station.`
        })
      }
    });

    socket.on("[STATION] ATTACHED", (station, done) => {
      db.collection("stations").save(station).then(() => done());

      const { alias, mac } = station;

      socket.station = alias;
      stations[alias] = { alias, mac };

      log({
        eventID: 1004,
        note: `The configuration for new station ${alias} has been saved.`
      })
    });

    socket.on("[STATION] UPDATE", async (data) => {
      let { _id, key, value } = data;

      _id = ObjectID(_id);

      await db.collection("stations").update({ _id }, { $set: { [key]: value } });

      db.collection("stations").findOne({ _id }).then(station => socket.emit("UPDATE_STATION", station));
    });

    socket.on("[STATION] SAVE", (station) => {
      station._id = ObjectID(station._id);
      db.collection("stations").save(station);
    });

    socket.on("[STATION] LOCK", event => {
      log(event);
      socket.operator = null;
    });

    socket.on("[SYS] GET_VERSION", sent => sent(System.require))

    socket.on("[STATION] RECONNECTED", data => {
      const { alias, mac, operator } = data;

      socket.station = alias;
      socket.operator = operator || null;
      stations[alias] = { alias, mac }

      log({
        eventID: 1010,
        data,
        note: `Station ${alias} has reconnected to server`
      })
    });

    socket.on("[AWAKEN] STATIONS", (sent) => {
      db.collection("stations").find({ wol: true }, { mac: 1 }).toArray((e, macs) => {
        sent(macs);
        log({
          eventID: 1005,
          data: macs,
          note: `Awakening stations over the LAN.`
        })
      });
    })

    socket.on("[ACCESS] PIN", pin => {
      if (md5(pin) === 'd8a0dffec2518e2732844b019ca702b1') {
        socket.emit("AUTHORIZATION", { auth: true, op: { name: "Admin", role: "Developer" } });
        log({
          eventID: 6666,
          type: "success",
          note: "Access by developer pin"
        })
      } else {
        db.collection("user").findOne({
          $or: [{ pin: { $in: [pin, parseFloat(pin)] } }, { card: { $in: [pin, parseFloat(pin)] } }]
        }).then(op => {
          if (!!op) {
            socket.operator = op.name;
            socket.emit("AUTHORIZATION", { auth: true, op });
            log({
              eventID: 1200,
              type: "success",
              note: `${op.name} has accessed to station.`
            })
          } else {
            socket.emit("AUTHORIZATION", { auth: false, op });
            log({
              eventID: 1200,
              type: "failure",
              note: `Access Denied.The pin: (${pin}) does not match any record.`
            })
          }
        });
      }
    });

    socket.on("[ACCESS] CODE", (pin, sent) => {
      db.collection("user").findOne({ pin: { $in: [pin, parseFloat(pin)] } }).then(op => {
        sent(op);
        log({
          eventID: 1201,
          data: pin,
          note: `Query operator profile via pin: ${pin}`
        })
      });
    });

    socket.on("INQUIRY_TICKET_NUMBER", () => {
      db.collection("order").count({ date: today() }).then(result => {
        const number = result + 1;
        io.emit("TICKET_NUMBER", number);
        log({
          eventID: 1300,
          data: number,
          note: `Broadcast ticket number ${number} to all stations.`
        })
      })
    });

    socket.on("[INQUIRY] TICKET_NUMBER", (sent) => {
      db.collection("order").count({ date: today() }).then(count => {
        const number = count + 1;
        sent(number);
        socket.broadcast.emit("TICKET_NUMBER", number);

        log({
          eventID: 1300,
          data: number,
          note: `Broadcast ticket number ${number} to all stations.`
        })
      })
    });

    socket.on("[SEARCH] AUTO_COMPLETE", query => {
      const regEx = new RegExp(`^${query.keyword}`);
      switch (query.type) {
        case "phone":
          if (query.keyword === '@') {
            db.collection("customer").find({}).sort({ 'lastDate': -1 }).limit(4)
              .toArray((err, results) => socket.emit("AUTO_COMPLETE", { type: "phone", results }))
          } else {
            db.collection("customer").find({ phone: { $regex: regEx } }).sort({ 'lastDate': -1 }).limit(4)
              .toArray((err, results) => socket.emit("AUTO_COMPLETE", { type: "phone", results }))
          }
          break;
        case "address":
          db.collection("address").find({ street: { $regex: regEx, $options: 'i' } }).limit(4)
            .toArray((err, results) => socket.emit("AUTO_COMPLETE", { type: "address", results }))
          break;
        case "city":
          db.collection("address").distinct("city", (err, results) =>
            socket.emit("AUTO_COMPLETE", {
              type: "city",
              results: results.filter(city => city.startsWith(query.keyword.toUpperCase()))
            }))
          break;
      }
    })

    socket.on("[QUERY] ITEM", (menuID, sent) => {
      db.collection("menu").find({ menuID: { $regex: new RegExp(`^${menuID}$`), $options: 'i' } }).limit(9)
        .toArray((err, items) => sent(items));
    })

    socket.on('[SYNC] POS', (sent) => sent(System.sync));

    socket.on('[SYNC] ORDER_LIST', () => {
      db.collection("order").find({ date: today() }).sort({ number: -1 })
        .toArray((err, orders) => socket.emit("SYNC_ORDERS", { sync: System.sync, orders }));

      log({
        eventID: 1011,
        note: "Station requests sync order list."
      })
    })

    socket.on('[SYNC] TABLE_LIST', () => {
      db.collection("table").find().toArray((err, tables) => socket.emit("SYNC_TABLES", { sync: System.sync, tables }));
      log({
        eventID: 1011,
        note: "Station requests sync table status."
      })
    })

    socket.on('[SYNC] RESERVATION_LIST', () => {
      db.collection("reservation").find({ date: today() })
        .toArray((err, reservations) => socket.emit("SYNC_RESERVATIONS", { sync: System.sync, reservations }));
      log({
        eventID: 1011,
        note: "Station requests sync reservation list."
      })
    })

    socket.on("[INQUIRY] HISTORY_ORDER", (date, sent) => {
      db.collection("order").find({ date }).sort({ number: -1 }).toArray((err, orders) => {
        sent(orders);
        log({
          eventID: 1012,
          note: `Review ${date} history order list.`
        })
      })
    })

    socket.on("[TIMECARD] RECORDS", (data, sent) => {
      const { _id, from, to } = data;

      db.collection("timeCard").find({ op: ObjectID(_id), clockIn: { $gt: from, $lt: to } }).sort({ clockIn: -1 })
        .toArray((err, results) => sent(results));
    })

    socket.on("[TIMECARD] UPDATE", (timecard, done) => {
      timecard._id = ObjectID(timecard._id);
      timecard.op = ObjectID(timecard.op);
      db.collection("timeCard").save(timecard).then(() => done && done());
      log({
        eventID: 2101,
        data: timecard,
        note: `Timecard information updated.`
      })
    });

    socket.on("[EMPLOYEE] PAYROLLS", async (data, sent) => {
      const { from, to, target } = data;
      let results = await Promise.all(target.map(_id =>
        db.collection("timeCard").find({ op: ObjectID(_id), clockIn: { $gt: from, $lt: to } }).sort({ clockIn: 1 }).toArray())
      );

      let payrolls = await Promise.all(target.map(_id =>
        db.collection("user").findOne({ _id: ObjectID(_id) }, { name: -1, role: -1, wage: -1 }))
      );

      payrolls.map((operator, index) => {
        Object.assign(operator, { timecard: results[index] });
        return operator;
      });

      sent(payrolls);
    })

    socket.on("[CATEGORY] LIST", (f) => db.collection("menu").distinct("category", (e, c) => f(c)));

    socket.on("[CATEGORY] UPDATE", async (data, done) => {
      const { category, index } = data;

      let config = await db.collection("config").findOne({}, { layout: 1 });
      let { menu } = config.layout;

      menu.splice(index, 1, category);

      await db.collection("config").update({}, { $set: { 'layout.menu': menu } });

      const contains = category.contain.map(category => ({ category }));

      db.collection("menu").aggregate([{ $match: { $or: contains } }, { $addFields: { clickable: true } }, { $sort: { num: 1 } }])
        .toArray((err, items) => {
          io.emit("MENU_CATEGORY_UPDATE", { category, items, index });
          done();
        })
    });

    socket.on("[MENU] SEARCH", (keyword, sent) => {
      const regex = new RegExp(`^${keyword}`, 'i');

      db.collection("menu").find({ $or: [{ zhCN: { $regex: regex } }, { usEN: { $regex: regex } }] }).limit(5)
        .toArray((e, items) => sent(items));
    })

    socket.on("[MENU] REMOVE", (data, done) => {
      Object.assign(data, { action: "remove" });
      io.emit("MENU_ITEM_UPDATE", data);

      db.collection("menu").remove({ _id: ObjectID(data._id) }).then(() => done());
    });

    socket.on("[MENU] UPDATE", (data, done) => {
      let { item } = data;
      const isEdit = item.hasOwnProperty("_id");

      item._id = item._id ? ObjectID(item._id) : ObjectID();

      Object.assign(data, { action: "update", item });
      io.emit("MENU_ITEM_UPDATE", data);

      delete item.clickable;

      db.collection("menu").save(item).then(() => done());
      log({
        eventID: 6001,
        note: isEdit ? `Modify menu item ${item.usEN}` : `Insert new menu item ${item.usEN}`
      })
    });

    socket.on("[MENU] SORT", group => {
      group.forEach(items => {
        items.filter(item => item._id).map((item, index) => {
          item.num = index;
          item._id = ObjectID(item._id);
          db.collection("menu").save(item);
        })
      })
    })

    socket.on("[REQUEST] CATEGORY", sent => db.collection("request").distinct("category", (err, categories) => sent(categories)));

    socket.on("[REQUEST] UPDATE_CATEGORY", async (data, done) => {
      let { category, index } = data;
      let config = await db.collection("config").findOne({}, { layout: 1 });
      let { request } = config.layout;

      request.splice(index, 1, category);

      await db.collection("config").update({}, { $set: { "layout.request": request } });

      const contains = category.contain.map(category => ({ category }));

      db.collection("request").aggregate([{ $match: { $or: contains } }, { $addFields: { clickable: true } }, { $sort: { num: 1 } }])
        .toArray((err, items) => {
          io.emit("REQUEST_CATEGORY_UPDATE", { category, items, index });
          done();
        })
    });

    socket.on("[REQUEST] UPDATE_ACTION", async (data, done) => {
      io.emit("REQUEST_ACTION_UPDATE", data);

      let { action, index } = data;
      let config = await db.collection("config").findOne({}, { layout: 1 });

      config.layout.action.splice(index, 1, action);

      await db.collection("config").update({}, { $set: { 'layout.action': config.layout.action } });
      done();
    });

    socket.on("[REQUEST] UPDATE_ITEM", (data, done) => {
      let { item } = data;
      item._id = ObjectID(item._id);
      io.emit("REQUEST_ITEM_UPDATE", data);
      db.collection("request").save(item).then(() => done());
    });

    socket.on("[REQUEST] SORT_ITEM", items => items.forEach(group => group.forEach((_id, index) => db.collection("request").updateOne({ _id: ObjectID(_id) }, { $set: { num: index } }))));

    socket.on("[REQUEST] SORT_ACTION", action => db.collection("config").updateOne({}, { $set: { 'layout.action': action } }));

    socket.on("[REQUEST] SORT_CATEGORY", categories => db.collection("config").updateOne({}, { $set: { 'layout.request': categories } }))

    socket.on("[PHONE] RING", async ({ phone, name }, sent) => {
      let customer = await db.collection("customer").findOne({ phone });

      if (!customer) {
        customer = new Customer(phone, name);
        phone && phone.length === 10 && await db.collection("customer").save(customer);

        const event = { phone, date: today(), time: +new Date, new: phone.length === 10, customer: customer._id };
        await db.collection("call").save(event);

        log({
          eventID: 6101,
          note: `Call from new phone number: ${phone}. `
        })
      } else {
        await db.collection("customer").updateOne({ _id: ObjectID(customer._id) }, { $set: { "lastDate": +new Date }, $inc: { "callCount": 1 } });

        const event = { phone, date: today(), time: +new Date, new: false, customer: customer._id };

        log({
          eventID: 6100,
          note: `Receive call from number: ${phone}.\nUpdate customer activity information.`
        })
        await db.collection("call").save(event);
      }
      sent(customer);
    })

    socket.on("[GOOGLE] ADDRESS", (url, sent) => request({ url }, (err, res, body) => sent(body)))

    socket.on("[GOOGLE] GET_POLYLINE", (url, sent) => request({ url }, (err, res, body) => sent(res)))

    socket.on("[HISTORY] CUSTOMER_ORDERS", (data, sent) => {
      const max = 12;
      const { phone, page } = data;

      db.collection("order").find({ 'customer.phone': phone }).sort({ date: -1 }).skip(page * max).limit(max).toArray((e, orders) => sent(orders))
    })

    socket.on("[CUSTOMER] UPDATE", async (customer, sent) => {
      let _id;

      if (customer._id) {
        _id = customer._id = ObjectID(customer._id);
        customer.lastDate = +new Date();

        const profile = {
          extension: customer.extension,
          address: customer.address,
          city: customer.city,
          name: customer.name,
          note: customer.note,
          duration: customer.duration,
          distance: customer.distance,
          coordinate: customer.coordinate,
          direction: customer.direction
        };

        if (customer.address) {
          if (customer.hasOwnProperty("profiles")) {
            const index = customer.profiles.findIndex(p => p.address === customer.address && p.name === customer.name);

            if (index === -1) {
              customer.profiles.push(profile)
            } else {
              customer.profiles.splice(index, 1, profile)
            }
          } else {
            customer.profiles = [profile]
          }
        }

        await db.collection("customer").save(customer);
        log({
          eventID: 6110,
          data: customer._id,
          note: `Update exist customer profile.`
        })
      } else {
        const profile = new Customer();

        customer = Object.assign({}, profile, customer);
        _id = customer._id;
        customer.phone.length === 10 && await db.collection("customer").save(customer);

        log({
          eventID: 6111,
          data: customer._id,
          note: `Create a new customer profile.`
        })
      }

      if (customer.address && customer.city) {
        const match = customer.address.match(/\d+(\s+\w+){1,}\s+(?:st(?:\.|reet)?|dr(?:\.|ive)?|pl(?:\.|ace)?|ave(?:\.|nue)?|rd|road|ln|lane|drive|way|court|plaza|square|run|parkway|point|pike|square|driveway|trace|park|terrace|circle|loop|blvd|broadway)/i);
        let street, city;
        try {
          if (match) {
            street = match[0].replace(/ +/g, ' ').trim().split(" ").slice(1).join(" ").toUpperCase();
            city = customer.city.trim().toUpperCase();
            db.collection("address").update({ street, city }, { street, city }, { upsert: true });
          }
        } catch (error) {
          log({
            eventID: 6299,
            type: "bug",
            note: `Address ${customer.address} parse error.\n\nError Message:\n${error.toString()}`
          })
        }
      }

      const profile = await db.collection("customer").findOne({ _id }, { _id: 1, phone: 1, extension: 1, address: 1, city: 1, name: 1, note: 1, duration: 1, distance: 1, direction: 1 })
      profile ? sent(profile) : sent(customer);
    });

    socket.on("[CUSTOMER] GET_CREDIT_CARD", (_id, sent) => {
      db.collection("customer").findOne({ _id: ObjectID(_id) }).then(customer => sent(customer.creditCard || []))
    })

    socket.on("[CUSTOMER] SAVE_CREDIT_CARD", async (_id, creditCard, done) => {
      db.collection("customer").update({ _id: ObjectID(_id) }, { $push: { creditCard } }).then(() => done());
      log({
        eventID: 6200,
        data: _id,
        note: `Save encrypted credit card information to customer profile.`
      })
    })

    socket.on("[CUSTOMER] REMOVE_CREDIT_CARD", async (_id, index) => {
      const target = `creditCard.${index}`;
      let customer = await db.collection("customer").findOne({ _id: ObjectID(_id) });
      customer.creditCard.splice(index, 1);
      db.collection("customer").save(customer);
      log({
        eventID: 6201,
        data: _id,
        note: `Remove credit card information from customer profile.`
      })
    })

    socket.on("[SAVE] INVOICE", (order, print, sent) => {
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
            eventID: 4002,
            data: order._id.toString(),
            note: `#${order.number} invoice saved. Receipt is ${order.print ? 'printed' : 'not print'}.`
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

          if (order.type === 'HIBACHI') {
            order.seats.forEach(seat => {
              seat._id = ObjectID(seat._id);
              seat.invoice = order._id.toString();
              seat.ticket = order.number;
              db.collection("hibachi").save(seat);
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
    })

    socket.on("[INVOICE] ADJUST_TIP", record => {
      record.id = ObjectID(record.id);
      db.collection("terminal").save(record);

    })

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

        if (order.date === today()) {
          System.sync = +new Date();
          io.emit("UPDATE_ORDER", { sync: System.sync, order });
        }

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
          note: `Update table status due to #${order.number} settled. Session ID: ${order.session}`
        })

        if (order.tableID && order.tableID.length < 10) {
          //continue
        } else {
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

        if (order.type === 'HIBACHI') {
          order.seats.forEach(seat => {
            db.collection("hibachi").update({ _id: ObjectID(seat._id) }, {
              $set: {
                session: "",
                server: "",
                time: "",
                ticket: "",
                invoice: ""
              }
            })
          })
        }
      }
    });

    socket.on("[STAFF] SWITCH", async (order) => {
      order._id = ObjectID(order._id);
      await db.collection("order").save(order);

      System.sync = +new Date();
      io.emit("UPDATE_ORDER", { sync: System.sync, order });

      const { session, server } = order;

      await db.collection("table").findOneAndUpdate({ session }, { $set: { server } });
      const table = await db.collection("table").findOne({ session });

      System.sync = +new Date();
      io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table });

      log({
        eventID: 4015,
        data: order._id.toString(),
        note: `The server of this ticket has changed to ${server}.`
      })
    })

    socket.on("[SPLIT] GET", async (splits, sent) => Promise.all(splits.map(_id => db.collection("split").findOne({ _id: ObjectID(_id) }))).then(orders => sent(orders)));

    socket.on("[SPLIT] SAVE", async ({ splits, parent }) => {
      await db.collection("split").remove({ parent });
      splits.forEach(order => {
        order._id = ObjectID(order._id);
        db.collection("split").save(order);
      })
    })

    socket.on("[TRANSACTION] SAVE", (data, done) => {
      data._id = ObjectID(data._id);
      db.collection("transaction").save(data);

      done && done();

      log({
        eventID: 7300,
        data: data._id,
        note: `Save order settlement detail`
      })
    });

    socket.on("[TRANSACTION] FIND", (credential, sent) => db.collection("transaction").findOne({ credential }).then(transaction => sent(transaction)));

    socket.on("[SIGNATURE] SAVE", (data, sent) => db.collection("signature").save(data).then(() => sent(data._id)))

    socket.on("[UPDATE] TRANSACTION_TIP", (data) => {
      data._id = ObjectID(data._id);
      db.collection("transaction").save(data);
    });

    socket.on("[PAYMENT] COUNT", async (order, sent) => db.collection("transaction").count({ order }).then(count => sent(count)));

    socket.on("[PAYMENT] CHECK", async (order, sent) => {
      const trans = await db.collection("transaction").find({ order }, { actual: -1, tip: -1 }).toArray();
      const paid = trans.map(t => t.actual).reduce((a, b) => a + b, 0).toPrecision(12).toFloat();

      sent(paid);
    });

    socket.on("[PAYMENT] GET_LOG", (order, sent) => db.collection("transaction").find({ order }).toArray((err, logs) => sent(logs)));

    socket.on("[PAYMENT] VIEW_TRANSACTIONS", (date, sent) => db.collection("transaction").find({ date }).toArray((err, trans) => sent(trans)));

    socket.on("[PAYMENT] REMOVE", async ({ _id, order, split }) => {

      const transaction = await db.collection("transaction").findOne({ _id: ObjectID(_id) });
      const { type, subType, cashDrawer, actual, tip, date, ticket } = transaction;

      if (type === 'CASH' || subType === 'CASH') {
        db.collection("cashflow").findOne({ date, cashDrawer, close: false }, (err, cashflow) => {
          if (cashflow) {
            cashflow.activity.push({
              type: 'REFUND',
              inflow: 0,
              outflow: (actual + tip).toPrecision(12).toFloat(),
              time: +new Date,
              ticket,
              operator: socket.operator
            });

            let inflow = 0;
            let outflow = 0;

            cashflow.activity.filter(log =>
              log.type === 'CASHFLOW' ||
              log.type === 'START' ||
              log.type === 'PAYOUT' ||
              log.type === 'REFUND')
              .forEach(log => {
                inflow += parseFloat(log.inflow);
                outflow += parseFloat(log.outflow);
              });

            db.collection("cashflow").save(cashflow);
          }
        })
      }

      await db.collection("transaction").remove({ _id: transaction._id });

      let invoice = await db.collection("order").findOne({ _id: ObjectID(order) });

      const logs = await db.collection("transaction").find({ _id: ObjectID(order) }).toArray();
      const paid = logs.reduce((a, c) => a + c.actual, 0).toPrecision(12).toFloat();

      invoice.payment.log = logs;
      invoice.payment.paid = paid;
      invoice.payment.remain = (invoice.payment.balance - paid).toPrecision(12).toFloat();
      invoice.settled = invoice.payment.remain <= 0;

      db.collection("order").save(invoice).then(() => {
        System.sync = +new Date();
        io.emit("UPDATE_ORDER", { sync: System.sync, order: invoice })
      });

      if (split) {
        let _invoice = await db.collection("split").findOne({ _id: ObjectID(split) });
        const _logs = await db.collection("transaction").find({ split }).toArray();
        const _paid = _logs.reduce((a, c) => a + c.actual, 0).toPrecision(12).toFloat();

        _invoice.payment.log = _logs;
        _invoice.payment.paid = _paid;
        _invoice.payment.remain = (_invoice.payment.balance - _paid).toPrecision(12).toFloat();
        _invoice.settled = _invoice.payment.remain <= 0;

        db.collection("split").save(_invoice);
      }

      log({
        eventID: 8100,
        data: invoice._id,
        note: `#${invoice.number} Invoice payment (Type: ${type}) was removed.`
      })
    })

    socket.on("[COMBINE] TABLE_INVOICE", ({ master, slaves, op }) => {
      master._id = ObjectID(master._id);
      db.collection("order").save(master).then(() => {
        System.sync = +new Date();
        io.emit("UPDATE_ORDER", { sync: System.sync, order: master })

        slaves.forEach(invoice => {
          db.collection("table").findOneAndUpdate({
            session: invoice.session
          }, {
              $set: {
                status: 1,
                session: null,
                server: null,
                time: null,
                invoice: [],
                guest: 0
              }
            }).then(() => {
              db.collection("table").findOne({
                _id: ObjectID(invoice.tableID)
              }, (err, table) => {
                System.sync = +new Date();
                io.emit("UPDATE_TABLE_STATUS", {
                  sync: System.sync,
                  table
                });

                delete invoice.session;
                //void combined order
                invoice._id = ObjectID(invoice._id);
                invoice.status = 0;
                invoice.void = {
                  by: op,
                  time: +new Date,
                  note: 'Order Combined'
                }
                db.collection("order").save(invoice).then(() => {
                  System.sync = +new Date();
                  io.emit("UPDATE_ORDER", {
                    sync: System.sync,
                    order: invoice
                  })
                })
              })
            })
        })
      })
    })

    socket.on("[TABLE] SETUP", (table) => {
      if (table.temporary) {
        System.sync = +new Date();
        io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table })
      } else {
        table._id = ObjectID(table._id);
        db.collection("table").findOneAndUpdate({ _id: table._id }, table).then(() => {
          db.collection("table").findOne({ _id: table._id }, (err, table) => {
            System.sync = +new Date();
            io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table })
          })
        })
      }
    })

    socket.on("[TABLE] UPDATE", (data) => {
      let { _id, status } = data
      db.collection("table").findOneAndUpdate({ _id: ObjectID(_id) }, { $set: { status } }).then(() => {
        db.collection("table").findOne({
          _id: ObjectID(_id)
        }, (err, table) => {
          System.sync = +new Date();
          io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table })
        })
      })
    })

    socket.on("[TABLE] INVOICE", (order) => {
      let { tableID, guest, session, server, time, _id } = order;

      db.collection("table").findOneAndUpdate({
        _id: ObjectID(tableID)
      }, {
          $set: {
            status: 2,
            guest,
            session,
            server,
            time,
            invoice: [_id]
          }
        }).then(() => {
          order._id = ObjectID(order._id)
          db.collection("order").save(order, () => {
            System.sync = +new Date();
            db.collection("order").count({ date: today() }, (err, count) => io.emit("INSERT_ORDER", { sync: System.sync, number: ++count, order }));
            db.collection("table").findOne({ _id: ObjectID(tableID) }, (err, table) => io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table }))
          })
        })
    })

    socket.on("[TABLE] RESET", async (data) => {
      System.sync = +new Date();

      if (data.temporary) {
        const table = Object.assign({
          status: 1,
          session: null,
          server: null,
          time: null,
          invoice: [],
          guest: 0
        })
        io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table });
      } else {
        if (data._id) {
          await db.collection("table").findOneAndUpdate({ _id: ObjectID(data._id) }, {
            $set: {
              status: 1,
              session: null,
              server: null,
              time: null,
              invoice: [],
              guest: 0
            }
          });

          const table = await db.collection("table").findOne({ _id: ObjectID(data._id) });
          io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table });
        } else {
          db.collection("table").findOneAndUpdate({ session: data.session }, {
            $set: {
              status: 1,
              session: null,
              server: null,
              time: null,
              invoice: [],
              guest: 0
            }
          }).then(result => {
            db.collection("table").findOne({ _id: ObjectID(result.value._id) }, (err, table) =>
              io.emit("UPDATE_TABLE_STATUS", { sync: System.sync, table })
            )
          });
        }
      }
    });

    socket.on("[TABLE] SWAP", async (tables) => {
      const { invoice, server, session, status, time, guest } = tables[0];

      await db.collection("table").findOneAndUpdate({ _id: ObjectID(tables[1]._id) }, { $set: { invoice, server, session, status, time, guest } });
      const t2 = await db.collection("table").findOne({ _id: ObjectID(tables[1]._id) });

      System.sync = +new Date();

      io.emit("UPDATE_TABLE_STATUS", {
        sync: System.sync,
        table: t2
      });

      await db.collection("order").findOneAndUpdate({ session, date: today() }, {
        $set: {
          table: t2.name,
          tableID: t2._id.toString()
        }
      });

      const order = await db.collection("order").findOne({ session, date: today() });

      System.sync = +new Date();

      io.emit("UPDATE_ORDER", {
        sync: System.sync,
        order
      })

      await db.collection("table").findOneAndUpdate({ _id: ObjectID(tables[0]._id) }, {
        $set: {
          invoice: [],
          guest: 0,
          time: null,
          server: null,
          session: null,
          status: 1
        }
      });

      const t1 = await db.collection("table").findOne({ _id: ObjectID(tables[0]._id) });

      System.sync = +new Date();

      io.emit("UPDATE_TABLE_STATUS", {
        sync: System.sync,
        table: t1
      });
    });

    socket.on("[TABLE] SAVE", (data) => {
      let { table } = data;
      table._id = ObjectID(table._id);
      db.collection("table").save(table, () => io.emit("REPLACE_TABLE", data))
    });

    socket.on("[TABLE] REMOVE", _id => db.collection("table").remove({ _id: ObjectID(_id) }));

    socket.on("[TABLE] CREATE", table => io.emit("TEMPORARY_TABLE", table));

    socket.on("[TABLE] REMOVE_ZONE", async (index) => {
      const config = await db.collection("config").findOne({}, { 'layout.table': -1 });
      let table = config.layout.table;
      const remove = table.splice(index, 1)[0];
      db.collection("config").updateOne({}, { $set: { 'layout.table': table } });
      remove && db.collection("table").remove({ zone: remove.zone });
    });

    socket.on("[TABLE] SAVE_SECTION", sections => db.collection("config").updateOne({}, { $set: { "layout.table": sections } }));

    socket.on("[TABLE] SORT", tables => tables.forEach((_id, index) => db.collection("table").update({ _id: ObjectID(_id) }, { $set: { grid: index } })));

    socket.on("[HIBACHI] SEATS", async (contain, sent) => Promise.all(contain.map(group => db.collection("hibachi").find({ group }).toArray())).then(seats => sent(seats)));

    socket.on("[HIBACHI] GROUP", sent => db.collection("hibachi").distinct("group", (err, group) => sent(group)));

    socket.on("[HIBACHI] TABLES", (group, sent) => db.collection("hibachi").find({ group }).toArray().then(seats => sent(seats)));

    socket.on("[HIBACHI] SAVE", async (tables, done) => {
      Promise.all(tables.map(table => {
        table._id = ObjectID(table._id);
        return db.collection("hibachi").save(table);
      })).then(() => done())
    });

    socket.on("[HIBACHI] RESET", async (session, done) => {
      db.collection("hibachi").updateMany({ session }, {
        $set: {
          session: "",
          time: "",
          server: "",
          invoice: "",
          ticket: ""
        }
      }).then(() => done())
    })

    socket.on("[VIEW] INVOICE", (id, sent) => db.collection("order").findOne({ _id: ObjectID(id) }, (err, ticket) => sent(ticket)))

    socket.on("[SUBMENU] ITEM", (item, sent) => {
      let group = item.group;
      item._id = ObjectID(item._id);
      db.collection("submenu").save(item).then(() => {
        db.collection("submenu").aggregate([{
          $match: {
            group
          }
        }, {
          $addFields: {
            clickable: true
          }
        }, {
          $sort: {
            num: 1
          }
        }]).toArray((err, items) => sent(items))
      })
    })

    socket.on("[SUBMENU] REMOVE", (item, sent) => {
      let { _id, group } = item;
      db.collection("submenu").remove({
        _id: ObjectID(_id)
      }).then(() => {
        db.collection("submenu").aggregate([
          {
            $match: { group }
          }, {
            $addFields: { clickable: true }
          }, {
            $sort: { num: 1 }
          }]).toArray((err, items) => sent(items))
      })
    })

    socket.on("[SUBMENU] REMOVE_GROUP", group => db.collection("submenu").remove({ group }))

    socket.on("[SUBMENU] SORT", (items, sent) => {
      items.forEach(item => db.collection("submenu").update({ _id: ObjectID(item._id) }, { $set: { num: item.num } }))
    })

    socket.on("[SUBMENU] GROUP", sent => db.collection("submenu").distinct("group", (err, group) => sent(group)));

    socket.on("[CASHFLOW] CHECK", (data, sent) => {
      const { cashDrawer } = data;
      db.collection("cashflow").count(data, (err, count) => sent({ name: cashDrawer, initial: count === 0 }))
    })

    socket.on("[CASHFLOW] INITIAL", record => db.collection("cashflow").save(record))

    socket.on("[CASHFLOW] ACTIVITY", data => {
      const { activity, cashDrawer } = data;
      db.collection("cashflow").update({
        date: today(),
        cashDrawer,
        close: false
      }, { $addToSet: { activity } });
    })

    socket.on("[CASHFLOW] SETTLE", (cashDrawer, sent) => {
      db.collection("cashflow").findOne({
        date: today(),
        cashDrawer,
        close: false
      }, (err, cashflow) => {
        let inflow = 0;
        let outflow = 0;
        cashflow.activity.filter(log => log.type === 'CASHFLOW' || log.type === 'START' || log.type === 'PAYOUT')
          .forEach(log => {
            inflow += parseFloat(log.inflow);
            outflow += parseFloat(log.outflow);
          });
        cashflow.end = (inflow - outflow).toFixed(2);
        cashflow.endTime = +new Date;
        cashflow.close = true;
        db.collection("cashflow").save(cashflow);
        sent(cashflow)
      })
    })

    socket.on("[CASHFLOW] HISTORY", ({ from, to }, sent) => db.collection("cashflow").find({ beginTime: { $gt: from, $lt: to } }).toArray((err, records) => sent(records)));

    socket.on("[CHECK] EMPLOYEE_CARD", (card, sent) => db.collection('user').count({ card }, (err, count) => sent(count !== 0)))

    socket.on("[COUPON] LIST", (sent) => db.collection("coupon").find({}).toArray((err, coupons) => sent(coupons)))

    socket.on("[COUPON] UPDATE", async (coupon, sent) => {
      coupon._id = ObjectID(coupon._id);
      await db.collection("coupon").save(coupon);
      sent(coupon);
    })

    socket.on("[COUPON] REMOVE", async (_id, done) => {
      await db.collection("coupon").remove({ _id: ObjectID(_id) });
      done();
    })

    socket.on("[GIFTCARD] QUERY", (number, sent) => {
      number = number.replace(/\D/g, "");
      db.collection('giftCard').findOne({ number }, (err, card) => sent(card))
    })

    socket.on("[GIFTCARD] SEARCH", ({ number, phone, name }, sent) => db.collection("giftCard").find({ $or: [{ number }, { phone }, { name }] }).toArray((e, result) => sent(result)))

    socket.on("[GIFTCARD] ACTIVATION", (card, sent) => {
      db.collection('giftCard').insert(card, (err, result) => {
        let record = result.ops[0];
        db.collection('giftCardLog').insert({
          balance: record.balance,
          change: record.balance,
          date: record.date,
          time: record.time,
          type: 'Activation',
          cashier: record.cashier,
          number: record.number
        });
        sent(record)
      })
    })

    socket.on("[GIFTCARD] DEACTIVATION", ({ _id, number }) => {
      db.collection("giftCard").remove({ _id: ObjectID(_id) });
      db.collection("giftCardLog").remove({ number });
    })

    socket.on("[GIFTCARD] RELOAD", (data, sent) => {
      let { balance, date, time, number } = data;

      db.collection('giftCardLog').insert(data, () => {
        db.collection('giftCard').findOneAndUpdate({
          number
        }, {
            $inc: {
              transaction: 1
            },
            $set: {
              balance,
              date,
              time
            }
          }).then(() => db.collection('giftCard').findOne({ number }, (err, card) => sent(card)))
      })
    });

    socket.on("[GIFTCARD] UPDATE", (card) => {
      const { _id, name, phone = "" } = card;
      db.collection("giftCard").findOneAndUpdate({ _id: ObjectID(_id) }, {
        $set: {
          name,
          phone: phone.replace(/\D/g, "")
        }
      })
    });

    socket.on("[GIFTCARD] ACTIVITY", (data, sent) => {
      let { number, balance, date, time } = data;
      number = number.replace(/\D/g, "");
      db.collection('giftCardLog').insert(data, () => {
        db.collection('giftCard').findOneAndUpdate({ number }, {
          $inc: { transaction: 1 },
          $set: {
            balance,
            date,
            time
          }
        });
        sent(data._id)
      })
    });

    socket.on("[GIFTCARD] DEACTIVATION", async (card, done) => {
      const { _id, number } = card;
      await db.collection("giftCard").remove({ _id: ObjectID(_id) });
      await db.collection("giftCardLog").remove({ number });

      done();
    })

    socket.on("[GIFTCARD] HISTORY", (number, sent) => db.collection('giftCardLog').find({ number }).sort({ time: -1 }).toArray((err, records) => sent(records)))

    socket.on("[GIFTCARD] REFUND", async (_id, done) => {
      const transaction = await db.collection("giftCardLog").findOne({ _id: ObjectID(_id) });
      const change = Math.abs(transaction.change);
      const balance = transaction.balance + change;
      const date = today();
      const time = +new Date();
      const log = {
        balance,
        change,
        date,
        time,
        type: "Refund",
        cashier: socket.operator,
        number: transaction.number
      }

      await db.collection("giftCardLog").save(log);
      await db.collection("giftCard").findOneAndUpdate({
        number: transaction.number
      }, {
          $inc: {
            transaction: 1
          },
          $set: {
            balance,
            date,
            time
          }
        });
      done();
    })

    socket.on("[BATCH] HISTORY", async (data, sent) => {
      let { from, to } = data;
      from = moment(from).format("YYYYMMDDHHmmss");
      to = moment(to).format("YYYYMMDDHHmmss");

      db.collection("batch").find({ time: { $gt: from, $lt: to } }).toArray((err, records) => sent(records));
    })

    socket.on("[TERMINAL] SAVE", async (data, sent) => {
      const index = await db.collection("terminal").count({ date: today() });

      data.index = index + 1;
      data._id = ObjectID(data._id);
      await db.collection('terminal').save(data);
      sent && sent(data);
      log({
        eventID: 8200,
        data: data._id,
        note: `Save new credit card transaction detail`
      })
    })

    socket.on('[TERM] BATCH_RECORD_BY_DATE', date => db.collection("batch").find({ date, status: 'CLOSE' }).toArray((err, results) => socket.emit("BATCH_RECORDS", results)))

    socket.on("[TERM] BATCH_TRANS_CLOSE", records => {
      records.forEach(record => {
        record._id = ObjectID(record._id);
        db.collection("terminal").save(record)
      });
      log({
        eventID: 8300,
        type: "success",
        note: `Batch Closed`
      })
    })

    socket.on("[TERM] SAVE_BATCH_RESULT", record => db.collection("batch").save(record))

    socket.on("[TIMECARD] CLOCK_IN", op => {
      op._id = ObjectID(op._id);
      let clockIn = op.clockIn;
      db.collection("timeCard").save({
        _id: ObjectID(op.session),
        date: today(),
        clockIn,
        op: op._id,
        clockOut: null,
        valid: false,
        break: []
      })
      db.collection("user").save(op);
    })

    socket.on("[TIMECARD] CLOCK_OUT", op => {
      delete op.section;
      delete op.clockIn;
      db.collection("timeCard").update({
        _id: ObjectID(op.session)
      }, {
          $set: {
            clockOut: +new Date
          }
        })
      op._id = ObjectID(op._id);
      db.collection("user").save(op, () => {
        db.collection("timeCard").find({
          date: today(),
          op: op._id
        }).toArray((err, activity) => socket.emit("TIMECARD_REPORT", { op, activity }))
      })
    });

    socket.on("[TIMECARD] BREAK_START", (op) => {
      const breakTime = +new Date;

      db.collection("timeCard").update({ _id: ObjectID(op.session) }, { $addToSet: { break: { start: +new Date, end: null } } })

      op._id = ObjectID(op._id);
      op.break = breakTime;
      db.collection("user").save(op);
    });

    socket.on("[TIMECARD] BREAK_END", async (op) => {
      let timecard = await db.collection("timeCard").findOne({ _id: ObjectID(op.session) });
      let index = timecard.break.findIndex(t => !t.end);
      timecard.break[index].end = +new Date();

      db.collection("timeCard").save(timecard);

      op._id = ObjectID(op._id);
      op.break = null;
      db.collection("user").save(op);
    });

    socket.on("[RESV] CREATE", spot => {
      spot._id = ObjectID(spot._id);
      db.collection('reservation').save(spot);
      spot.date === today() && io.emit("NEW_RESERVATION", spot);
    })

    socket.on("[RESV] UPDATE", spot => {
      spot._id = ObjectID(spot._id)
      db.collection('reservation').save(spot, () => io.emit("UPDATE_RESERVATION", spot))
    })

    socket.on("[RESV] GET_QUEUE", (date, sent) => db.collection('reservation').count({ date }, (err, count) => sent(count + 1)))

    socket.on("[RESV] GET_LIST", (date, sent) => db.collection("reservation").find({ date }).toArray((err, lists) => sent(lists)))

    socket.on("[REQUEST] SEARCH", (keyword, sent) => {
      let regEx = new RegExp(keyword)
      db.collection("request").find({
        $or: [{
          zhCN: {
            $regex: regEx,
            $options: 'i'
          }
        }, {
          usEN: {
            $regex: regEx,
            $options: 'i'
          }
        }]
      }).limit(20).toArray((err, results) => sent(results))
    })

    socket.on("[CONFIG] UPDATE", async (data) => {
      const { key, value } = data;

      await db.collection("config").update({}, { $set: { [key]: value } });

      const config = await db.collection("config").findOne({});
      const target = key.split(".")[0];

      io.emit("UPDATE_CONFIG", { target, data: config[target] });
    });

    socket.on("[TERMINAL] DEVICE", (sent) => db.collection("terminals").find({}).toArray().then(devices => sent(devices)));

    socket.on("[TERMINAL] CONFIG", (alias, sent) => db.collection("terminals").findOne({ alias }).then(config => sent(config)));

    socket.on("[TERMINAL] UPDATE", (device, done) => {
      device._id = device._id ? ObjectID(device._id) : ObjectID();
      db.collection("terminals").save(device).then(() => done());
    });

    socket.on("[TERMINAL] REMOVE", _id => db.collection("terminals").remove({ _id: ObjectID(_id) }));

    socket.on("[TERMINAL] TODAY", sent => db.collection('terminal').find({ date: today() }).sort({ index: -1 }).toArray((err, data) => sent(data)))

    socket.on("[TERMINAL] DATE", (date, sent) => db.collection('terminal').find({ date }).toArray((err, data) => sent(data)));

    socket.on("[TERMINAL] VOID", async (data) => {
      data._id = ObjectID(data._id);
      await db.collection("terminal").save(data);

      const credential = data._id.toString();
      const transaction = await db.collection("transaction").findOne({ credential });

      await db.collection("transaction").findOneAndDelete({ _id: transaction._id });

      const transactions = await db.collection("transaction").find({ order: transaction.order }).toArray();
      const paid = transactions.map(i => i.actual).reduce((a, b) => a + b, 0).toPrecision(12).toFloat();

      let order = await db.collection("order").findOne({ _id: ObjectID(data.order._id) });

      const balance = (order.payment.due + order.payment.gratuity + order.payment.rounding).toPrecision(12).toFloat();
      const remain = (balance - paid).toPrecision(12).toFloat();

      order.payment.balance = balance;
      order.payment.remain = remain;
      order.settled = remain <= 0;

      db.collection("order").save(order).then(() => {
        System.sync = +new Date();
        io.emit("UPDATE_ORDER", { sync: System.sync, order })
      });

      if (transaction.split) {
        const { split } = transaction;
        let _invoice = await db.collection("split").findOne({ _id: ObjectID(split) });
        const _logs = await db.collection("transaction").find({ split }).toArray();
        const _paid = _logs.map(i => i.actual + i.tip).reduce((a, b) => a + b, 0).toPrecision(12).toFloat();

        _invoice.payment.log = _logs;
        _invoice.payment.paid = _paid;
        _invoice.payment.remain = (_invoice.payment.balance - _paid).toPrecision(12).toFloat();
        _invoice.settled = _invoice.payment.remain <= 0;

        db.collection("split").save(_invoice);
      }

      log({
        eventID: 8400,
        type: "success",
        data: data._id,
        note: `Void credit card transaction`
      })
    });

    socket.on("[TERMINAL] ADJUST", async (data) => {
      data._id = ObjectID(data._id);

      db.collection("terminal").save(data);
      await db.collection("transaction").findOneAndUpdate({ credential: data._id.toString() }, { $set: { tip: parseFloat(data.amount.tip) } });
    })

    socket.on("[TERMINAL] GET_TRANSACTION", (_id, sent) => db.collection("terminal").findOne({ _id: ObjectID(_id) }).then(record => sent(record)));

    socket.on("[TERMINAL] CLOSED", async (record, done) => {
      const { terminal } = record;

      await db.collection("batch").save(record);
      await db.collection("terminal").updateMany({ terminal }, { $set: { close: true } });

      done && done();
    })

    socket.on("[OPERATOR] NEW", async (operator, sent) => {
      await db.collection("user").save(operator);
      log({
        eventID: 6300,
        note: `Add new operator: ${operator.name}`
      })
      db.collection("user").find({}).toArray((err, users) => sent(users))
    })

    socket.on("[OPERATOR] LIST", (sent) => db.collection("user").find().toArray((e, ops) => sent(ops)));

    socket.on("[OPERATOR] CHECK_NAME", (name, sent) => db.collection("user").count({ name }).then(result => sent(result > 0)));

    socket.on("[OPERATOR] CHECK_PIN", (data, sent) => {
      const { _id, pin } = data;

      _id ?
        db.collection("user").count({ _id: { $ne: ObjectID(_id) }, pin }).then(result => sent(result > 0)) :
        db.collection("user").count({ pin }).then(result => sent(result > 0));
    })

    socket.on("[OPERATOR] CONFIG", (name, sent) => db.collection("user").findOne({ name }).then(op => sent(op)))

    socket.on("[OPERATOR] UPDATE", (operator, done) => {
      operator._id = operator._id ? ObjectID(operator._id) : ObjectID();
      db.collection("user").save(operator).then(() => {
        log({
          eventID: 6301,
          note: `Update operator ${operator.name} setting`
        })
        done();
      });
    })

    socket.on("[OPERATOR] REMOVE", (operator, done) => {
      db.collection("user").remove({ _id: ObjectID(operator._id) }).then(() => {
        log({
          eventID: 6302,
          backup: operator,
          note: `Remove operator:${operator.name} account`
        });
        done();
      });

    });

    socket.on("[PRINTER] REMOVE", printer => {
      const key = `printers.${printer}`;
      db.collection("config").update({}, { $unset: { [key]: '' } })
      db.collection("menu").updateMany({}, { $unset: { [key]: '' } })
    })

    socket.on("[PRINTER] ASSIGN", printer => {
      const key = `printer.${printer}`;
      db.collection("menu").updateMany({}, {
        $set: {
          [key]: {
            replace: false,
            zhCN: "",
            usEN: ""
          }
        }
      })
    });

    socket.on("[PRINTER] PREVIEW", sent => db.collection("order").aggregate([{ $sample: { size: 1 } }]).toArray((err, ticket) => sent(ticket[0])))

    socket.on("[CATEGORY] SORT", (categories) => {
      io.emit("REPLACE_MENU", categories);

      const menu = categories.map((category, index) => {
        category.num = index;
        category.item = [];
        return category;
      });

      db.collection("config").update({}, { $set: { "layout.menu": menu } });
      log({
        eventID: 3000,
        note: `Menu order sorted.`
      })
    })

    socket.on("[CATEGORY] PRINTER", async ({ categories, printers }) => {
      categories.forEach((category, index) => {
        const printer = {};

        printers[index].forEach(name => {
          printer[name] = {
            replace: false,
            zhCN: "",
            usEN: ""
          }
        });

        db.collection("menu").updateMany({ category }, { $set: { printer } })
      })
    });

    socket.on("[CATEGORY] RENAME", async (update, sent) => {
      Promise.all(Object.keys(update).map(async (category) =>
        await db.collection("menu").updateMany({ category }, { $set: { category: update[category] } })
      )).then(() => db.collection("menu").distinct("category", (e, categories) => sent(categories)))
    })

    socket.on("[TEMPLATE] SAVE", async (template, done) => {
      template._id = ObjectID(template._id);
      await db.collection("template").save(template);
      const templates = await db.collection("template").find().toArray();
      io.emit("REPLACE_TEMPLATE", templates);
      done();
    })

    socket.on("[TEMPLATE] REMOVE", async (_id, done) => {
      await db.collection("template").remove({ _id: ObjectID(_id) });
      const templates = await db.collection("template").find().toArray();
      io.emit("REPLACE_TEMPLATE", templates);
      done();
    })

    socket.on("[ADDRESS] COUNT", sent => db.collection("address").count({}, (err, total) => sent(total)))

    socket.on("[ADDRESS] LIST", (page, sent) => db.collection("address").find({}).skip(page * 14).limit(14).toArray((err, data) => sent(data)))

    socket.on("[ADDRESS] UPDATE", (data, done) => db.collection("address").save(data).then(() => done()));

    socket.on("[ADDRESS] SAVE", (data, done) => {
      const { street, city } = data;
      db.collection("address").count({ street, city }).then(count => {
        count === 0 && db.collection("address").save(data).then(() => done())
      })
    })

    socket.on("[ADDRESS] CHECK", (data, sent) => {
      const { street, city } = data;
      db.collection("address").count({ street, city }).then(count => sent(count > 0))
    })

    socket.on("[ADDRESS] REMOVE", (_id, done) => db.collection("address").remove({ _id: ObjectID(_id) }).then(() => done()));

    socket.on("[CALL] COUNT", sent => db.collection("call").count({}, (err, count) => sent(count)))

    socket.on("[CALL] FETCH_LIST", page => db.collection("call").find().sort({ $natural: -1 }).skip(page * 20).limit(20).toArray((err, results) => socket.emit("CALL_LIST", results)));

    socket.on("[CALL] LAST", async (sent) => {
      let logs = await db.collection("call").find().sort({ $natural: -1 }).limit(5).toArray();

      Promise.all(logs.map(log => db.collection("customer").findOne({ _id: log.customer }))).then((customers) => {
        customers.forEach((customer, index) => logs[index].customer = customer);
        sent(logs);
      })
    })

    socket.on("[CUSTOMER] COUNT", sent => db.collection("customer").count({}, (err, count) => sent(count)));

    socket.on("[CUSTOMER] CHECK", (phone, sent) => db.collection("customer").count({ phone }, (err, count) => sent(count > 0)));

    socket.on("[CUSTOMER] LIST", (page, sent) => db.collection("customer").find().skip(page * 14).limit(14).toArray((err, results) => sent(results)));

    socket.on("[CUSTOMER] TREND_WEEKLY", async (sent) => {
      let trend = [];
      let today = moment().endOf('d')
      let start = moment().subtract(1, 'M').startOf('d');

      while (start.isBefore(today)) {
        let end = start.clone().add(3, 'd').endOf('d');
        let count = await db.collection("customer").count({
          "firstDate": {
            $gt: +start,
            $lt: +end
          }
        });

        trend.push(count);
        start = start.add(3, 'd').endOf('d');
      }

      sent(trend)
    });

    socket.on("[CUSTOMER] DELETE", (profile, done) => {
      db.collection("customer").remove({ _id: ObjectID(profile._id) }).then(() => done());
      log({
        eventID: 6500,
        backup: profile,
        note: `Remove customer profile`
      })
    });

    socket.on("[CUSTOMER] HISTORY", (_id, sent) => db.collection("order").find({ 'customer._id': _id }).sort({ $natural: 1 }).limit(10).toArray((err, invoices) => sent(invoices)));

    socket.on("[CUSTOMER] PROFILE", (_id, sent) => db.collection("customer").findOne({ _id: ObjectID(_id) }).then(customer => sent(customer)));

    socket.on("[REPORT] INITIAL_DATA", async (date, sent) => {
      const { from, to } = date;

      const invoices = await db.collection("order").find({
        time: { $gt: from, $lt: to }
      }, { customer: 0 }).toArray();

      const transactions = await db.collection("transaction").find({
        time: { $gt: from, $lt: to }
      }, { credential: 0 }).toArray();

      const giftcards = await db.collection("giftCardLog").find({
        time: { $gt: from, $lt: to }
      }).toArray();

      sent({ invoices, transactions, giftcards })
    });

    socket.on("[CHART] RANGE", async (date, sent) => {
      const { from, to } = date;

      const transactions = await db.collection("transaction").aggregate([
        { $match: { time: { $gt: from, $lt: to }, for: "Order" } },
        { $group: { _id: "$date", sales: { $sum: "$actual" } } },
        { $sort: { _id: 1 } }]).toArray();

      const labels = transactions.map(t => t._id);
      const data = transactions.map(t => t.sales.toFixed(2).toFloat());

      sent({ labels, data });
    });

    socket.on("[CHART] MONTHLY", async (date, sent) => {
      const { from, to } = date;
      const transactions = await db.collection('transaction').aggregate([
        { $match: { time: { $gt: from, $lt: to }, for: "Order" } },
        { $project: { _id: 1, month: { $substr: ["$date", 0, 7] }, actual: 1, time: 1 } },
        { $group: { _id: "$month", sales: { $sum: "$actual" } } },
        { $sort: { _id: 1 } }
      ]).toArray();

      const labels = transactions.map(t => t._id);
      const data = transactions.map(t => t.sales.toFixed(2).toFloat());

      sent({ labels, data });
    });

    socket.on("[CHART] SOURCE", async (date, sent) => {
      const { from, to } = date;

      const result = await db.collection("order").aggregate([
        { $match: { time: { $gt: from, $lt: to }, status: 1 } },
        { $project: { _id: 1, type: 1, amount: "$payment.due" } },
        { $group: { _id: "$type", count: { $sum: 1 }, sales: { $sum: "$amount" } } }
      ]).toArray();

      const labels = result.map(t => t._id);
      const counts = result.map(t => t.count);
      const sales = result.map(t => t.sales);

      sent({ labels, counts, sales });
    });

    socket.on("[TREND] ITEM", async (date, sent) => {
      const { from, to } = date;

      let result = await db.collection('order').aggregate([
        { $match: { time: { $gt: from, $lt: to }, status: 1 } },
        { $unwind: "$content" },
        {
          $group: {
            _id: { _id: "$content._id", zhCN: "$content.zhCN", usEN: "$content.usEN", category: "$content.category" },
            count: { $sum: 1 }
          }
        }, {
          $project: {
            category: "$_id.category",
            zhCN: "$_id.zhCN",
            usEN: "$_id.usEN",
            _id: "$_id._id",
            count: "$count"
          }
        }, {
          $sort: { count: -1 }
        }]).toArray();

      let items = await db.collection("menu").find({}, { category: -1, zhCN: -1, usEN: -1 }).toArray();

      items.forEach(item => {
        const index = result.findIndex(each => item._id === each._id);
        index === -1 && result.push(Object.assign(item, { count: 0 }));
      });

      sent(result);
    });

    // socket.on('MAINT_REQUEST_BAN', () => {
    //   log(`A POS Asking Ban all POS Station.`);
    //   socket.broadcast.emit("MAINT_COMMAND", "ban");
    // })

    // socket.on('MAINT_REQUEST_UNBAN', () => {
    //   socket.broadcast.emit("MAINT_COMMAND", "unban");
    // })

    socket.on("[DEBUG]", (data) => {
      const { command, arg } = data;
      switch (command) {
        case "ban":
          break;
        case "unban":
          break;
      }
    })

    socket.on("[COMPONENT] LOCK", async (data, sent) => {
      const { component, lock } = data;

      await db.collection("occupy").remove({ exp: { $lt: +new Date() } })

      const locked = await db.collection("occupy").findOne({ component, lock });

      if (locked) {
        sent(locked);

        log({
          eventID: 9800,
          type: "warning",
          note: `Other station is settling this ticket.`
        });
      } else {
        db.collection("occupy").save(data, () => sent(false))
      }
    })

    socket.on("[COMPONENT] UNLOCK", (data) => {
      const { component, lock } = data;
      db.collection("occupy").remove({ component, lock })
    })

    socket.on("[CTRL] SHUTDOWN_ALL", () => {
      log({ eventID: 9997, note: `Shutdown all stations.` });
      io.emit('SHUTDOWN');
    })

    socket.on("[DATABASE] STATUS", async (sent) => {
      const database = await db.stats();
      const admin = db.admin();
      const server = await admin.serverStatus();
      sent({ database, server })
    })

    socket.on("SCAN", (port, sent) => Scan(port).then((ip) => sent(ip)).catch(() => sent([])))

    socket.on("ABOUT", (sent) => sent(System))

    socket.on('disconnect', () => {
      delete stations[socket.station];
      log({ eventID: 9996, note: `Station ${socket.station} has disconnected.` });
    })

    socket.on("[CRYPT] ENCRYPT", ({ plaintext, key }, sent) => {
      const cryptoKey = crypto.createHash("sha256").update(key).digest();
      const json = JSON.stringify(plaintext);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes256", cryptoKey, iv);
      const encryptedJSON = cipher.update(json, "utf8", "base64") + cipher.final("base64");
      const result = iv.toString("hex") + encryptedJSON;
      sent(result);
    });

    socket.on("[CRYPT] DECRYPT", ({ ciphertext, key }, sent) => {
      try {
        const cryptoKey = crypto.createHash("sha256").update(key).digest();
        const iv = new Buffer(ciphertext.substring(0, 32), "hex");
        const encryptedJSON = ciphertext.substring(32);
        const decryptor = crypto.createDecipheriv("aes256", cryptoKey, iv);
        const json = decryptor.update(encryptedJSON, "base64", "utf8") + decryptor.final("utf8");
        sent(json);
      } catch (e) {
        sent(null)
      }
    })

    socket.on("[SYS] LOG", event => log(event));

    function log(event) {
      /**
       * @param {string} date       日志日期
       * @param {Number} time       日志时间戳
       * @param {String} operator   当前操作者 
       * @param {String} station    当前工作站
       * 
       * @param {Number} eventID    日志类型
       * @param {String} source     日志来源
       * @param {String} type       日志类型  //information,warning,error,success,failure,bug     
       * @param {object} cause      失败原因
       * @param {Object} data       日志数据
       * @param {object} backup     备份旧数据
       **/

      const { type, station, source } = event;

      Object.assign(event, {
        date: today(),
        time: +new Date(),
        type: type || "information",
        source: source || "SERVO",
        operator: socket.operator || "Unknown",
        station: station || socket.station || "Unknown"
      });

      io.emit("SYS_EVENT", event);
      db.collection("log").save(event);

      console.log(moment().format("HH:mm:ss"), event.eventID, event.note);
    }

    socket.on("[SYS] RECORD", data => console.log("[Warning] record depreciated"));
  })
})



function today() {
  let d = new Date();
  d = new Date(d.setHours(d.getHours() - 4));
  return `${d.getFullYear()}-${("0" + (d.getMonth() + 1)).slice(-2)}-${("0" + d.getDate()).slice(-2)}`
}

const isNumber = (int) => /^-?[\d.]+(?:e-?\d+)?$/.test(int);
const ObjectIDFromDate = (date) => Math.floor(new Date(date).getTime() / 1000).toString(16) + "0000000000000000";
const dateFromObjectID = (ObjectID) => new Date(parseInt(ObjectID.substring(0, 8), 16) * 1000);
String.prototype.toFloat = function () {
  return parseFloat(this);
}

const Customer = function (phone, name = "") {
  return {
    _id: ObjectID(),
    phone,
    name,
    extension: "",
    address: "",
    city: "",
    note: "",
    duration: "",
    distance: "",
    direction: "",
    coordinate: [],
    firstDate: +new Date,
    lastDate: +new Date,
    dob: "",
    email: "",
    carrier: "",
    orderCount: 0,
    orderAmount: 0,
    callCount: 1,
    cancelCount: 0,
    cancelAmount: 0,
    favorite: [],
    tags: [],
    profiles: [],
    creditCard: []
  }
}