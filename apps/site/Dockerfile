FROM node:lts-hydrogen

RUN mkdir /home/node/app/ && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package*.json ./

RUN chown node:node package.json && chown node:node package-lock.json

RUN npm install && npm cache clean --force --loglevel=error
COPY server.js .

RUN chown node:node server.js

EXPOSE 3000

USER node
CMD [ "node", "server.js"]