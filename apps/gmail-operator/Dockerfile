FROM node:lts-hydrogen

RUN mkdir /home/node/app/ && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY . .

RUN chown node:node *

RUN npm install && npm cache clean --force --loglevel=error
RUN npm run build

EXPOSE 3000

RUN chown node:node *
RUN ls -la /home/node/app/dist

USER node
CMD [ "node", "/home/node/app/dist/index.js"]