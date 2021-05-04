const { promisify } = require('util');
const process = require('process');
const grpc = require('grpc');

class Server {
    constructor(
        path,
        serialize,
        deserialze
    ) {
        this.grpcServer = new grpc.Server({
            'grpc.max_connection_age_ms': 2000 // 2 seconds
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
                Exec: (call, callback) => {
                    this.received++;
                    console.log('Received request', {
                        seq: call.request.seq,
                        hostname: process.env.HOSTNAME,
                        received: this.received
                    });
                    return callback(null, { message: 'Hello Client!' });
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
