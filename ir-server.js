const { execSync, exec } = require('child_process');
const request = require('request');
const http = require('http');

function parseArgs() {
    const minimist = require('minimist');
    let args = minimist(process.argv.slice(2), {
        alias: {
            h: 'help',
            v: 'verb',
            c: 'config'
        },
        default: {
            verb: 'info'
        }
    });
    if (args.help) {
        console.log(helpString());
        process.exit(0);
    }
    if (!args.hasOwnProperty('config')) {
        console.error(`[ERROR] Please specify service configuration file\n${helpString()}`);
        process.exit(1);
    }
    return args;
}

function helpString() {
    let scriptName = require('path').basename(__filename);
    let helpString = `Usage: node ${scriptName} [-h] [-c] CONFIG_FILE [-v] VERB_LEVEL`;
    helpString = helpString.concat("\n\nrequired arguments:");
    helpString = helpString.concat("\n  -c, --config  service configuration file");
    helpString = helpString.concat("\n\noptional arguments:");
    helpString = helpString.concat("\n  -h, --help    show this help message and exit");
    helpString = helpString.concat("\n  -v, --verb    verb level (default: info)");
    return helpString;
}

function parseConfig(configFile) {
    const fs = require('fs');
    let config = JSON.parse(fs.readFileSync(configFile));
    global.remoteName = config.remote.name;
    global.powerKey = config.remote.powerKey;
    global.tvIp = config.tv.ip;
    global.tvPort = config.tv.port;

    config.credentials = JSON.parse(fs.readFileSync(config.credentials));
    return config;
}

function initLogger(logConfig, logLevel) {
    const log4js = require('log4js');
    log4js.configure(
        {
            appenders: {
                file: {
                    type: 'file',
                    filename: logConfig.logFile,
                    maxLogSize: 1 * 1024 * 1024, // = 1Mb
                    numBackups: 3, // keep three backup files
                }
            },
            categories: {
                default: { appenders: ['file'], level: logLevel }
            }
        }
    );
    global.logger = log4js.getLogger(logConfig.logCategory);
}

function main() {
    const args = parseArgs();
    let config = parseConfig(args.config);
    initLogger(config.log, args.verb);
    logger.debug("Initiating server with arguments:\n", args);

    runServer(config.port);
    irw(config.credentials.url, config.credentials.token);
}

function runServer(port) {
    const hostname = '127.0.0.1';
    var server = http.createServer(onRequest);
    server.listen(port);
    logger.info(`IR controller has started. Server running at http://${hostname}:${port}/`);
}

function onRequest(request, response) {
    logger.debug("Processing request:\n", request);
    try {
        var command = request.headers['ir-command'];
        if (command == "on") {
            power(POWER_ON);
            return;
        }
        if (command == "off") {
            power(POWER_OFF);
            return;
        }
        if (command == "status") {
            var ps = refresh();
            response.setHeader("power-status", ps == POWER_ON ? "on" : "off");
            return;
        }

        var remote = request.headers['remote-name'];
        var msg = `irsend SEND_ONCE ${remote} ${command}`;
        execmd(msg);

        // check if this command need to be repeated
        var repeat = parseInt(request.headers.repeat, 10);
        if (repeat > 1) {
            repeatCmd(msg, repeat - 1);
        }
    }
    catch (error) {
        logger.error(`"${error.message}" occured while processing:\n`, request);
    }
    finally {
        logger.debug("Response:\n", response);
        response.end();
    }
}

function execmd(command) {
    logger.info("executing command: ".concat(command));
    try {
        var stdout = execSync(command).toString();
        if (stdout) {
            logger.info(`stdout: ${stdout}`);
        }
        return {'isError': false, 'stdout': stdout};
    }
    catch (error) {
        logger.error(error.message);
        return {'isError': true, 'errorMessage': error.message};
    }
}

const sleepInterval = 0.5 // seconds
async function repeatCmd(command, repeat){
    logger.info(`repeating ${repeat} times of command ${command}`);
    for (var i = 0; i < repeat; i++) {
        logger.info(`repeat ${i + 1}/${repeat} times`);
        await sleep(sleepInterval * 1000);
        execmd(command);
    }
}

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

const POWER_ON = 1;
const POWER_OFF = -1;
const POWER_UNKNOWN = 0;
function getStatus() {
    let nmapCmd = `nmap --host-timeout 1 -p ${tvPort} ${tvIp}`;
    let results = execmd(nmapCmd);

    if (!results.isError) {
        if (results.stdout == null) return POWER_UNKNOWN;
        var arrayOfLines = results.stdout.match(/[^\r\n]+/g);
        if (arrayOfLines.length < 1) return POWER_UNKNOWN;

        var statusLine = arrayOfLines[arrayOfLines.length - 1];
        if (statusLine.includes("(1 host up)")) {
            return POWER_ON;
        } else if (statusLine.includes("(0 hosts up)")) {
            return POWER_OFF;
        }
    }
    return POWER_UNKNOWN;
}

let powerStatus = POWER_UNKNOWN;
function irw(url, token) {
    logger.info("monitering ir commands");
    let repeat = 5;
    while (repeat > 0 && powerStatus == POWER_UNKNOWN) {
        powerStatus = getStatus();
        repeat = repeat - 1
    }
    if (powerStatus == POWER_UNKNOWN) throw "Can't get TV status, abort ir server";
    logger.info(`power status starts with ${powerStatus}`);
    notifyPowerEvent(url, token, powerStatus);

    var irw = exec('irw', function(error, stdout, stderr) {});
    irw.stdout.on('data', function(data) {
        var data = String(data);
        if (data.includes(`00 ${powerKey} ${remoteName}`)) {
            powerStatus = powerStatus * -1;
            logger.info(`changing power status to ${powerStatus}`);
            notifyPowerEvent(url, token, powerStatus);
        }
    });
}

function power(powerValue) {
    if (refresh() != powerValue) {
        var msg = `irsend SEND_ONCE ${remoteName} ${powerKey}`;
        execmd(msg);
    }
}

function refresh() {
    powerStatus = getStatus();
    return powerStatus;
}

function notifyPowerEvent(url, token, ps) {
    logger.info("notifying power event:", ps);

    let command = (ps == POWER_ON) ? "on" : "off"
    request(
        {
            url: `${url}/${command}`,
            headers: { Authorization: `Bearer ${token}` }
        },
        function(err, res) {
            if(err) {
                logger.error(err);
            } else {
                logger.info(res.body);
            }
        }
    );
}

main();
