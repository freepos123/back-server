const { MongoClient, ObjectID } = require('mongodb')
const app = require('http').createServer()
const io = require('socket.io')(app)
const Scan = require('./scanner.js')
const request = require("request")
const moment = require("moment")
const md5 = require('md5')

const url = "mongodb://localhost:27017/UnitedPOS";
const production = false;

let stations = {};

MongoClient.connect(url, (error, db) => {
    if (error) {
        console.log(error);
        return;
    }

    const bootstrap = require('./events/bootstrap')(io,db);

    app.listen(8888);
});