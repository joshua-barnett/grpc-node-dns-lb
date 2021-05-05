FROM node:14.16.1-slim@sha256:027ca5b035e85229e96ebd4e60c26386126e6a208f238561759b3d68ac50cae9 as dependencies

WORKDIR /srv

COPY package* ./

RUN npm ci

FROM node:14.16.1-slim@sha256:027ca5b035e85229e96ebd4e60c26386126e6a208f238561759b3d68ac50cae9 as artifact

WORKDIR /srv

COPY . .
COPY --from=dependencies /srv/node_modules .