const Net = require('net')
const Ip = require('ip')
const ip = Ip.address().split(".").splice(0, 3).join(".") + ".";

let scanner = function (port) {
    return new Promise((resolve, reject) => {
        let target = [], start = 1, end = 255, count = 0, done = false;
        while (start <= end) {
            let host = ip + start;
            (function (host, port) {
                let s = Net.connect({ host, port }, () => { p(s), target.push(host) })
                s.on('error', () => { p(s) })
                setTimeout(() => { p(s) }, 2000)
            })(host, port);
            start++;
        }

        function p(s) {
            s.destroy();
            if (++count > 255 && !done) {
                done = true;
                resolve(target)
            }
        }

        setTimeout(() => {
            reject([])
        }, 15000)
    })
}

module.exports = scanner;