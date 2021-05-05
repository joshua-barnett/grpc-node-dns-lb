const { promisify } = require('util');
const { setTimeout, setInterval } = require('timers');
const grpc = require('grpc');
const process = require('process');

const timeout = promisify(setTimeout);
const randomBoundedInt = (min, max) => Math.floor(Math.random() * max) + min;
const randomDelay = () => timeout(randomBoundedInt(1, 10));

class Client {
    constructor(
        path,
        serialize,
        deserialze
    ) {
        this.path = path;
        this.serialize = serialize;
        this.deserialze = deserialze;
        this.retryLimit = 1;
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
        this.waitForReady = promisify((...args) => this.grpcClient.waitForReady(...args));
        this.makeUnaryRequest = promisify((...args) => this.grpcClient.makeUnaryRequest(...args));
    }
    isRetryableError(error) {
        switch (error.code) {
            case grpc.status.UNAVAILABLE:
                return true;
            default:
                return false;
        }
    }
    async exec(body = {}, retries = 0) {
        try {
            const response = await this.makeUnaryRequest(
                this.path,
                this.serialize,
                this.deserialze,
                body
            );
            return response;
        } catch (error) {
            console.error(error);
            if (this.isRetryableError(error) && retries < this.retryLimit) {
                return this.exec(body, retries++);
            }
            throw error;
        }
    }
    async run(repeat = 10000, delay = false) {
        await this.waitForReady(Infinity);
        for (let seq = 0; seq < repeat; seq++) {
            const response = await this.exec({ seq, delay });
            console.log(response);
            if (typeof delay === 'boolean') {
                if (delay) {
                    await randomDelay();
                }
            } else if (typeof delay === 'number') {
                await timeout(delay);
            }
        }
    }
}

module.exports = {
    Client
};
