let { MongoClient, ObjectID } = require('mongodb');
const url = "mongodb://127.0.0.1:27017/UnitedPOS";

function today() {
    let d = new Date();
    d = d.setHours(d.getHours() - 4);
    d = new Date(d);
    return `${d.getFullYear()}-${("0" + (d.getMonth() + 1)).slice(-2)}-${("0" + d.getDate()).slice(-2)}`
}

function dateFromObjectId(value) {
    return new Date(parseInt(value.substring(0, 8), 16) * 1000);
};

MongoClient.connect(url, (err, db) => {
    err && console.log(err);
    // let index = 1;
    // db.collection("order").find({ date: today() }).forEach(invoice => {
    //     console.log('update invoice',invoice.number);
    //     invoice.number = index++;
    //     db.collection("order").save(invoice);
    // });

    db.collection("order").find({time:{$exists:false}}).forEach(invoice=>{
        console.log('fixing invoice',invoice.number)
        invoice.time = +dateFromObjectId(invoice._id.toString());
        db.collection('order').save(invoice)
    })
})