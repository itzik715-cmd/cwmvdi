FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf

# nginx master must run as root but worker processes run as 'nginx' user
# Remove default user directive to use nginx.conf defaults
RUN chown -R nginx:nginx /usr/share/nginx/html

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
