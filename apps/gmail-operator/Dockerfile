FROM node:lts-hydrogen

RUN mkdir /home/node/app/ && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY . .

RUN chown node:node *

RUN npm install && npm cache clean --force --loglevel=error
RUN npm run build

EXPOSE 3000

USER node
CMD [ "node", "dist/index.js"]