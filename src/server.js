const { promisify } = require('util');
const { setTimeout } = require('timers');
const grpc = require('grpc');
const process = require('process');

const timeout = promisify(setTimeout);
const randomBoundedInt = (min, max) => Math.floor(Math.random() * max) + min;
const randomDelay = () => timeout(randomBoundedInt(200, 500));

class Server {
    constructor(
        path,
        serialize,
        deserialze
    ) {
        this.grpcServer = new grpc.Server({
            'grpc.max_connection_age_ms': 1000
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
    async run(port = `0.0.0.0:${process.env.SERVER_PORT || 50051}`) {
        const grpcServerBind = promisify((...args) => this.grpcServer.bindAsync(...args));
        await grpcServerBind(port, grpc.ServerCredentials.createInsecure());
        this.grpcServer.start();
    }
}

module.exports = {
    Server
};
