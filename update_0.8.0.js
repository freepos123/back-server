const { MongoClient, ObjectID } = require('mongodb');
const url = "mongodb://127.0.0.1:27017/UnitedPOS";
const moment = require('moment');

MongoClient.connect(url, async (err, db) => {

    // let config = await db.collection("config").findOne();

    // let { store, printer } = config;
    // let { table, tax } = store;

    // store.matrix = {
    //     enable: false,
    //     provider: "Google",
    //     autoCorrect: false,
    //     api: "AIzaSyBGZN1d3vvFVsV5clLATb8oVmrUCpyqgLE"
    // }
    // store.email = {
    //     enable: false,
    //     username: "",
    //     password: ""
    // }
    // store.tipSuggestion = {
    //     enable: false,
    //     percentage: "15,18,20"
    // }

    // delete store.table;

    // let printer = config.printer;
    // delete config.printer;



    // config.printers = printer
    // config.tax = tax;
    // config.dinein = table;

    //await db.collection("config").save(config);

    db.collection("customer").find().toArray((err, customers) => {
        customers.forEach(customer => {
            console.log("update", customer.phone);

            Object.assign(customer, customer.extra);
            delete customer.extra;
            customer.profiles = [];
            db.collection("customer").save(customer);
        })
    })
})