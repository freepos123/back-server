const mongoClient = require('mongodb').MongoClient;
const ObjectId = require('mongodb').ObjectID;
const url = "mongodb://127.0.0.1:27017/UnitedPOS";
const colors = require('colors');

const patchNode = ["0.5.0", "0.5.3", "0.6.0", "0.6.3", "0.6.6", "0.6.7", "0.6.8", "0.7.0"];
const targetVersion = patchNode.slice(-1);

mongoClient.connect(url, (err, db) => {
    err && console.log(err);

    db.collection("config")
        .find({})
        .toArray((err, config) => {
            let { database } = config[0].version;
            if (database === targetVersion) {
                db.close();
                console.log(`Your Database is Up to Date`);
                console.log('Press any key to exit');

                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.on('data', process.exit.bind(process, 0));
                return;
            }
            console.log(`\n\nCurrent Database Version:${database} \nTarget Database Version:${targetVersion} \n\nPreparing Update...\n`);
            let index = patchNode.indexOf(database) + 1;
            update(patchNode[index], db);
        })
})


function update(version, db) {
    switch (version) {
        case "0.5.0":
            done(db, version);
            break;
        case "0.5.3":
            console.log("[ADD] prices params\n".green);
            db.collection("menu").find().snapshot().forEach(elem => {
                db.collection("menu").update({
                    _id: elem._id
                }, {
                        $set: {
                            prices: {
                                DEFAULT: elem.price
                            }
                        }
                    })
            });
            done(db, version);
            break;
        case "0.6.0":
            console.log("[CHANGE] Action *layout* key change to => *prefix* \n".green);
            db.collection("config").find()
                .toArray((err, result) => {
                    let layout = result[0].layout.action;
                    layout = layout.map(item => {
                        item.prefix = item.layout === 1;
                        delete item.layout;
                        return item
                    });
                    db.collection("config").update({}, {
                        $set: {
                            "layout.action": layout
                        }
                    })
                });
            done(db, version);
            break;
        case "0.6.3":
            console.log("[CHANGE] *Order* time change type from String => Number \n".green);
            db.collection("order").find({}).forEach(ticket => {
                ticket.time = parseInt(ticket.time, 10);
                if (ticket.lastEdit) {
                    ticket.lastEdit = parseInt(ticket.lastEdit, 10);
                }
                //ticket._id = ObjectId(ticket._id);
                db.collection("order").save(ticket);
            });
            done(db, version);
            break;
        case "0.6.6":
            console.log("[ADD] *Template* Collection ADD key to each contain item".green)
            db.collection("template").find({}).forEach(template => {
                template.contain.forEach(contain => {
                    contain.contain.forEach(item => {
                        !item.hasOwnProperty("key") && (item.key = Math.random().toString(36).substring(3, 7))
                    })
                })
                db.collection("template").save(template);
            })
            done(db, version);
            break;

        case "0.6.7":
            console.log("[CHANGE] *Order* Due now is Total - Discount\n".green);
            db.collection("order").find({}).forEach(ticket => {
                console.log("UPDATING", ticket.number, " Date:", ticket.date);
                try {
                    ticket.payment.due = parseFloat(ticket.payment.total) - parseFloat(ticket.payment.discount);
                }
                catch (e) {
                    console.log(ticket.number, 'Data corrupted \n', ticket.payment);
                }
                db.collection("order").save(ticket);
            })
            done(db, version);
            break;
        case "0.6.8":
            console.log("Fixed Credit Card calc error\n".green);
            db.collection("order").find({}).forEach(ticket => {
                if (ticket.payment.type === 'CREDIT') {
                    console.log("UPDATE TICKET", ticket.number, " Date:", ticket.date);
                    ticket.payment.due = ticket.payment.paidCredit;
                }
                db.collection("order").save(ticket);
            })
            done(db, version);
            break;
        case "0.7.0":
            console.log("Check payment issue, rerun all invoices");
            db.collection("order").find({}).forEach(invoice => {
                console.log("Fixing invoice #" + invoice.number);
                invoice.payment.balance = "0.00";
                invoice.payment.due = (parseFloat(invoice.payment.total) - parseFloat(invoice.payment.discount)).toFixed(2);
                db.collection("order").save(invoice);
            });
            break;
        case "0.7.1":
            console.log("ADD display params to config");
            db.collection("config").update({}, {
                display: {
                    menuID: false,
                    favorite: false,
                    voidItem:false
                }
            });
            break;
        default:
            return false
    }
}

function done(db, version) {
    console.log(`DONE patch database! \nUpdating database version to ${version}\n\n`.red);
    db.collection("config").update({}, { $set: { "version.database": version } })
    console.log("FINISHED JOB!".yellow);
    console.log('Press any key to exit'.bgRed);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 0));
}

function fixPayment(ticket) {
    let { payment } = ticket;
    let balance = "0.00";

}