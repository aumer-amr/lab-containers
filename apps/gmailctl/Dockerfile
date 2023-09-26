FROM golang:1.18-bullseye as INSTALL

ENV CONFIG_DIR=/config

RUN go install github.com/mbrt/gmailctl/cmd/gmailctl@latest

RUN mkdir /home/node/app/ && chown -R node:node /home/node/app
RUN mv /go/bin/gmailctl /home/node/app/gmailctl
RUN gmailctl init --config $CONFIG_DIR

FROM node:lts-hydrogen

WORKDIR /home/node/app

COPY package*.json ./

RUN chown node:node package.json && chown node:node package-lock.json

RUN npm install && npm cache clean --force --loglevel=error
COPY runner.js .

RUN chown node:node runner.js
RUN chown node:node gmailctl

EXPOSE 3000

USER node
CMD [ "node", "runner.js"]