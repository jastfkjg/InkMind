FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY . .
ENV VITE_API_URL=/api
RUN npm run build
ARG VCS_REF=development
RUN node -e 'require("fs").writeFileSync("dist/frontend-health.json", JSON.stringify({status:"ok",service:"inkmind-frontend",revision:process.env.VCS_REF}))'

FROM nginx:alpine
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
