FROM --platform=amd64 public.ecr.aws/amazonlinux/amazonlinux:2023
#FROM --platform=amd64 public.ecr.aws/amazonlinux/amazonlinux:2
#FROM --platform=arm64 public.ecr.aws/amazonlinux/amazonlinux:2023

# Install tools and Ollama in a single layer to reduce image size
RUN yum install -y wget gzip tar python3 python3-pip \
#&& wget https://github.com/ollama/ollama/releases/download/v0.5.12/ollama-linux-arm64.tgz -O /tmp/ollama.tgz \
&& wget https://github.com/ollama/ollama/releases/download/v0.5.12/ollama-linux-amd64.tgz -O /tmp/ollama.tgz \
&& mkdir -p /mnt \
    && tar -xzf /tmp/ollama.tgz -C /mnt \
    && rm -rf /tmp/ollama.tgz \
    && chmod +x /mnt/bin/ollama \
    && yum clean all \
    && rm -rf /var/cache/yum/*

# Install required Python packages
RUN pip3 install boto3 requests

# Copy your application code 
COPY server.py /app/

# Define working directory
WORKDIR /app

# Set PATH to include Ollama binary
ENV PATH="/mnt/bin:${PATH}"

# Expose port for Ollama API
EXPOSE 8080 11434

# Set the command to run your application
CMD ["python3", "server.py"]
