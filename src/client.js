const { promisify } = require('util')
const { setTimeout } = require('timers')
const grpc = require('grpc')
const process = require('process')

const DELAY = process.env.DELAY !== '0'
const REPEAT = 10000
const MAX_RANDOM_DELAY = 10
const MIN_RANDOM_DELAY = 1
const RETRY_LIMIT = 1
const GRPC_DNS_MIN_TIME_BETWEEN_RESOLUTIONS_MS = 0

const timeout = promisify(setTimeout)
const randomBoundedInt = (min, max) => Math.floor(Math.random() * max) + min
const randomDelay = () =>
  timeout(randomBoundedInt(MIN_RANDOM_DELAY, MAX_RANDOM_DELAY))

class Client {
  constructor (path, serialize, deserialze) {
    this.path = path
    this.serialize = serialize
    this.deserialze = deserialze
    this.retryLimit = RETRY_LIMIT
    this.grpcClient = new grpc.Client(
      process.env.SERVER_ADDRESS || 'dns:///localhost:50051',
      grpc.credentials.createInsecure(),
      {
        'grpc.dns_min_time_between_resolutions_ms': GRPC_DNS_MIN_TIME_BETWEEN_RESOLUTIONS_MS,
        'grpc.service_config': JSON.stringify({
          loadBalancingConfig: [
            {
              round_robin: {}
            }
          ]
        })
      }
    )
    this.waitForReady = promisify((...args) =>
      this.grpcClient.waitForReady(...args)
    )
    this.makeUnaryRequest = promisify((...args) =>
      this.grpcClient.makeUnaryRequest(...args)
    )
  }
  isRetryableError (error) {
    switch (true) {
      case error.code === grpc.status.UNAVAILABLE &&
        error.details === 'GOAWAY received':
        return true
      default:
        return false
    }
  }
  async exec (body = {}, retries = 0) {
    try {
      const { seq } = body
      console.log(`${seq}: Sending request`)
      const response = await this.makeUnaryRequest(
        this.path,
        this.serialize,
        this.deserialze,
        body
      )
      console.log(`${seq}: Received response`)
      return response
    } catch (error) {
      const { seq } = body
      console.error(`${seq}: ${error.message}`)
      if (this.isRetryableError(error) && retries < this.retryLimit) {
        return this.exec(body, retries++)
      }
      throw error
    }
  }
  async run (repeat = REPEAT, delay = DELAY) {
    await this.waitForReady(Infinity)
    for (let seq = 0; seq < repeat; seq++) {
      const shutdown = seq === repeat - 1
      await this.exec({ seq, delay, shutdown })
      if (typeof delay === 'boolean') {
        if (delay) {
          await randomDelay()
        }
      } else if (typeof delay === 'number') {
        await timeout(delay)
      }
    }
  }
}

module.exports = {
  Client
}
