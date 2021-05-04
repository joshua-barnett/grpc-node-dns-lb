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
    $(DOCKER_COMPOSE) run $(if $(RUN_DETACHED),--detach )--rm --name $(NAME) $(SERVICE) $(COMMAND); \
fi

.PHONY: shell
shell: NAME = shell
shell: COMMAND = bash
shell: command

.PHONY: test
test:
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

.PHONY: clean
clean:
	$(DOCKER_COMPOSE) down --volumes
