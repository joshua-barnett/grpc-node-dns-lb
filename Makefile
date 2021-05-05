DOCKER = docker
DOCKER_COMPOSE = docker-compose
SERVICE = shell

export COMPOSE_DOCKER_CLI_BUILD = 1
export DOCKER_BUILDKIT = 1

.PHONY: command
command:
	@RUNNING=`$(DOCKER) ps --quiet --filter name=^/$(NAME)$$`; \
if [ $${RUNNING} ]; then \
    $(DOCKER) exec --interactive --tty $(NAME) $(COMMAND); \
else \
    $(DOCKER_COMPOSE) run $(if $(RUN_DETACHED),--detach )--rm --service-ports --name $(NAME) $(SERVICE) $(COMMAND); \
fi

.PHONY: shell
shell: NAME = shell
shell: COMMAND = bash
shell: command

.PHONY: clean
clean:
	$(DOCKER_COMPOSE) down --volumes

.PHONY: test-auto-scaling
test-auto-scaling: clean
	$(DOCKER_COMPOSE) up --build client server & \
sleep 10; \
$(DOCKER_COMPOSE) up --detach --scale server=2 server; \
sleep 10; \
$(DOCKER_COMPOSE) up --detach --scale server=3 server; \
sleep 10; \
$(DOCKER_COMPOSE) up --detach --scale server=2 server; \
sleep 10; \
$(DOCKER_COMPOSE) up --detach --scale server=1 server; \
sleep 10; \
$(DOCKER_COMPOSE) up --detach --scale server=0 --scale client=0 client server;

.PHONY: test-retries
test-retries: clean
	DELAY=0 $(DOCKER_COMPOSE) up --build client server
