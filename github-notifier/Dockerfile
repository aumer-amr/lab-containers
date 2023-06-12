FROM node:18

# Node part
WORKDIR /usr/scr/app

COPY ./app/package*.json ./
RUN npm install

COPY ./app .

COPY entrypoint.sh /

EXPOSE 8080
CMD ["/entrypoint.sh"]
