FROM n8nio/n8n:latest

COPY frame-proxy.js /home/node/frame-proxy.js
COPY start-with-frame-proxy.sh /home/node/start-with-frame-proxy.sh

USER root
RUN chmod +x /home/node/start-with-frame-proxy.sh
USER node

CMD ["sh", "/home/node/start-with-frame-proxy.sh"]
