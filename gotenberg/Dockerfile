FROM gotenberg/gotenberg:8-chromium

USER root

RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

USER gotenberg
