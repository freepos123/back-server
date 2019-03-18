const ip = require("ip");

module.exports.today = () => {
    let d = new Date();
    d = new Date(d.setHours(d.getHours() - 4));
    return `${d.getFullYear()}-${("0" + (d.getMonth() + 1)).slice(-2)}-${("0" + d.getDate()).slice(-2)}`
}

module.exports.isNumber = (int) => /^-?[\d.]+(?:e-?\d+)?$/.test(int);

module.exports.System = {
    version: "0.8.2",
    require: "0.8.2",
    build: 1513321771382,
    support: "(888)299-0524",
    startTime: new Date(),
    sync: +new Date(),
    host: ip.address()
};

module.exports.Stations = {};
