# GRPC Node.js DNS Load Balancing Example

An example of DNS load balancing with gRPC.

## Requirements

- [Make](https://www.gnu.org/software/make/)
- [Docker](https://docs.docker.com/get-docker/)

## Demo

[![asciicast](https://asciinema.org/a/LpXY8cR0RbbgSeC5T3F6zwXTo.svg)](https://asciinema.org/a/LpXY8cR0RbbgSeC5T3F6zwXTo)

## Getting Started

1. Clone the repository.

   ```shell
   git clone https://github.com/joshua-barnett/grpc-node-dns-lb
   ```

1. Run the test target.

   ```shell
   make test-auto-scaling

   make test-retries
   ```

   The project will start with 1 replica, scale up to 3 over the course of 20 seconds.

   Then scale down to 0 over the course of 20 seconds.

1. Clean project.

   ```shell
   make clean
   ```
