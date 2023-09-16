FROM node:lts-hydrogen

RUN mkdir /home/node/app/ && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package*.json ./
RUN npm install && npm cache clean --force --loglevel=error

COPY . .
RUN npm run build

EXPOSE 3000

RUN chown -R node:node /home/node/app
RUN ls -la /home/node/app/dist

USER node
CMD [ "node", "dist/index.js"]