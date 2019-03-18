const moment = require("moment");
const utils = require('./utils.js');
const { today, System, Stations } = utils;

console.log(System);

exports = module.exports = (io, db) => {
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

    io.sockets.on('connection', socket => {

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
                Stations[alias] = { alias, mac };

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
            Stations[alias] = { alias, mac };

            log({
                eventID: 1099,
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
    });
};