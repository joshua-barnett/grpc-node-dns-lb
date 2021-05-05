const { promisify } = require('util');
const { setTimeout } = require('timers');
const grpc = require('grpc');
const process = require('process');

const MAX_CONNECTION_AGE = 1000;
const MAX_RANDOM_DELAY = 500;
const MIN_RANDOM_DELAY = 500;
const SERVER_ADDRESS = `0.0.0.0:${process.env.SERVER_PORT || 50051}`;

const timeout = promisify(setTimeout);
const randomBoundedInt = (min, max) => Math.floor(Math.random() * max) + min;
const randomDelay = () => timeout(randomBoundedInt(MIN_RANDOM_DELAY, MAX_RANDOM_DELAY));

class Server {
    constructor(
        path,
        serialize,
        deserialze
    ) {
        this.grpcServer = new grpc.Server({
            'grpc.max_connection_age_ms': MAX_CONNECTION_AGE
        });
        this.received = 0;
        this.grpcServer.addService(
            {
                Exec: {
                    path,
                    requestStream: false,
                    responseStream: false,
                    responseSerialize: serialize,
                    requestDeserialize: deserialze
                }
            },
            {
                Exec: async (call, callback) => {
                    this.received++;
                    const { seq, delay } = call.request;
                    console.log('Received request', {
                        seq,
                        hostname: process.env.HOSTNAME,
                        received: this.received
                    });
                    if (typeof delay === 'boolean') {
                        if (delay) {
                            await randomDelay();
                        }
                    } else if (typeof delay === 'number') {
                        await timeout(delay);
                    }
                    return callback(null, { message: 'Hello Client!', seq });
                }
            }
        )
    }
    async run() {
        const grpcServerBind = promisify((...args) => this.grpcServer.bindAsync(...args));
        await grpcServerBind(SERVER_ADDRESS, grpc.ServerCredentials.createInsecure());
        this.grpcServer.start();
    }
}

module.exports = {
    Server
};
