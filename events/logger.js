exports = module.exports = (io, db) => {
    io.sockets.on('connection', socket => {
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
    })
}