const { execSync } = require('child_process');

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
    return JSON.parse(fs.readFileSync(configFile));
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

function runServer(port) {
    const http = require('http');
    const hostname = '127.0.0.1';
    var server = http.createServer(onRequest);
    server.listen(port);
    logger.info(`IR controller has started. Server running at http://${hostname}:${port}/`);
}

function onRequest(request, response) {
    logger.debug("Processing request:\n", request);
    try {
        var command = request.headers['ir-command'];
        var remote = request.headers['remote-name'];
        var msg = `irsend SEND_ONCE ${remote} KEY_${command}`;
        execmd(msg);
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
    }
    catch (error) {
        logger.error(error.message);
    }
}

function main() {
    const args = parseArgs();
    config = parseConfig(args.config);
    initLogger(config.log, args.verb);
    logger.debug("Initiating server with arguments:\n", args);

    runServer(config.port);
}

main();
