FROM node:16.13.1-alpine as build
ENV VUE_APP_NETEASE_API_URL=/api
WORKDIR /app

RUN export all_proxy=http://192.168.31.74:9890 

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories &&\
	apk add --no-cache python3 make g++ git
COPY package.json yarn.lock ./

COPY . .

RUN yarn config set electron_mirror https://npmmirror.com/mirrors/electron/ && \
    yarn build

FROM nginx:1.20.2-alpine as app

COPY --from=build /app/package.json /usr/local/lib/
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories && apk update

RUN apk add nodejs npm

RUN apk add libuv 

RUN npm config set registry https://registry.npmmirror.com

RUN npm i -g $(awk -F \" '{if($2=="NeteaseCloudMusicApi") print $2"@"$4}' /usr/local/lib/package.json) \
&& rm -f /usr/local/lib/package.json


COPY --from=build /app/docker/nginx.conf.example /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

CMD nginx ; exec npx NeteaseCloudMusicApi