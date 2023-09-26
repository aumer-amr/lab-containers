FROM golang:1.18-bullseye as builder
RUN go install github.com/mbrt/gmailctl/cmd/gmailctl@latest

FROM node:lts-hydrogen

RUN mkdir -p /home/node/app/ && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package*.json ./

RUN chown node:node package.json && chown node:node package-lock.json

RUN npm install && npm cache clean --force --loglevel=error
COPY runner.js .

RUN chown node:node runner.js

COPY --from=builder /go/bin/gmailctl /usr/local/bin/gmailctl

EXPOSE 3000

USER node
CMD [ "node", "runner.js"]