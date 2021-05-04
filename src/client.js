const process = require('process');
const { promisify } = require('util');
const { setTimeout } = require('timers');
const grpc = require('grpc');

const timeout = promisify(setTimeout);

class Client {
    constructor(
        path,
        serialize,
        deserialze
    ) {
        this.path = path;
        this.serialize = serialize;
        this.deserialze = deserialze;
        this.grpcClient = new grpc.Client(
            process.env.SERVER_ADDRESS || 'dns:///localhost:50051',
            grpc.credentials.createInsecure(), {
                'grpc.dns_min_time_between_resolutions_ms': 0,
                'grpc.service_config': JSON.stringify({
                    loadBalancingConfig: [{
                        round_robin: {}
                    }]
                })
            }
        );
    }
    async run(repeat = 10000, delay = 1000) {
        const waitForReady = promisify((...args) => this.grpcClient.waitForReady(...args));
        const makeUnaryRequest = promisify((...args) => this.grpcClient.makeUnaryRequest(...args));
        await waitForReady(Infinity);
        for (let seq = 0; seq < repeat; seq++) {
            try {
                const response = await makeUnaryRequest(
                    this.path,
                    this.serialize,
                    this.deserialze, {
                        seq
                    }
                );
                // console.log(response);
            } catch (error) {
                console.log(error);
            }
            await timeout(delay);
        }
    }
}

module.exports = {
    Client
};
