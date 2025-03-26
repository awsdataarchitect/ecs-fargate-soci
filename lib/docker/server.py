import os
import json
import subprocess
import logging
import asyncio
import boto3
import requests
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from time import sleep

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
BINARY_PATH = "/mnt/bin/ollama"
MODEL = os.getenv("OLLAMA_MODEL", "deepseek-r1:1.5b")
SERVICE_NAME = os.environ.get("SERVICE_NAME", "DefaultServiceName")
IMAGE_PULL_TIME_METRIC = "ImagePullTime"
NAMESPACE = "SOCI/Performance/v1"

def get_task_metadata():
    """Get ECS task metadata from the metadata endpoint"""
    try:
        metadata_uri = os.environ.get('ECS_CONTAINER_METADATA_URI_V4')

        # Get task metadata
        task_response = requests.get(f"{metadata_uri}/task")
        if task_response.status_code != 200:
            logger.error(f"Failed to get task metadata: {task_response.status_code}")
            return None

        task_metadata = task_response.json()
        return task_metadata

    except Exception as e:
        logger.error(f"Error getting task metadata: {e}")
        return None

def publish_metrics(metric_name, value, dimensions):
    """Publish metrics to CloudWatch"""
    try:
        cloudwatch = boto3.client('cloudwatch')
        cloudwatch.put_metric_data(
            Namespace= NAMESPACE,
            MetricData=[{
                'MetricName': metric_name,
                'Value': value,
                'Unit': 'Seconds',
                'Dimensions': dimensions
            }]
        )
        logger.info(f"Published metric {metric_name}: {value}")
    except Exception as e:
        logger.error(f"Error publishing metric {metric_name}: {e}")

async def run_ollama_and_measure_init():
    """Initialize Ollama"""
    logger.info("Starting Ollama initialization")
    
    try:

        # First, start the Ollama service
        logger.info("Starting Ollama service...")
        service_process = subprocess.Popen(
            [BINARY_PATH, "serve"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        #output, err = service_process.communicate()

        sleep(3)

        if service_process.poll() is not None:
            logger.error(f"Ollama service failed to start: {service_process.stderr.read().decode('utf-8')}")
            return False

        logger.info(f"serve {service_process} started successfully. ")

        # Pull the model
        logger.info(f"Pulling model {MODEL}...")

        process = subprocess.Popen(
            [BINARY_PATH, "pull", MODEL],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        output, err = process.communicate()
        
        if process.returncode != 0:
            logger.error(f"Error pulling model: {err.decode('utf-8')}")
            return False
            
        logger.info(f"Model {MODEL} pulled successfully")
        
        return True
        
    except Exception as e:
        logger.error(f"Error during model initialization: {e}")
        return False

async def initialize_background():
    """Initialize background tasks and collect metrics"""
    try:
        logger.info("Starting background initialization")
        logger.info(f"Service name: {SERVICE_NAME}")
        dimensions = [{"Name": "ServiceName", "Value": SERVICE_NAME}]

        # Initialize Ollama
        if not await run_ollama_and_measure_init():
            logger.error("Failed to initialize Ollama")
            return

        logger.info("Getting task metadata...")
        task_metadata = get_task_metadata()
        if not task_metadata:
            logger.error("Failed to get task metadata")
            return
       

        def parse_timestamp(timestamp_str):
            """Parse ECS timestamp format safely"""
            try:
                # Remove nanoseconds if present (everything after 6 decimal places)
                if '.' in timestamp_str:
                    parts = timestamp_str.split('.')
                    if len(parts) == 2:
                        # Keep only up to 6 digits for microseconds
                        microseconds = parts[1].split('+')[0][:6]
                        timestamp_str = f"{parts[0]}.{microseconds}+00:00"
                return datetime.fromisoformat(timestamp_str)
            except Exception as e:
                logger.error(f"Error parsing timestamp {timestamp_str}: {e}")
                return None

        # Calculate image pull time using task metadata
        if 'PullStartedAt' in task_metadata and 'PullStoppedAt' in task_metadata:
            try:
                pull_started_at = parse_timestamp(task_metadata['PullStartedAt'])
                pull_stopped_at = parse_timestamp(task_metadata['PullStoppedAt'])
        
                if pull_started_at and pull_stopped_at:
                    image_pull_time = (pull_stopped_at - pull_started_at).total_seconds()
                    logger.info(f"Image pull started at: {task_metadata['PullStartedAt']}")
                    logger.info(f"Image pull stopped at: {task_metadata['PullStoppedAt']}")
                    logger.info(f"Image pull time: {image_pull_time:.2f} seconds")
                    dimensions = [{"Name": "ServiceName", "Value": SERVICE_NAME}]            
                    # Publish the metric
                    publish_metrics(IMAGE_PULL_TIME_METRIC, image_pull_time, dimensions)
                else:
                    logger.error("Failed to parse pull timestamps")
            except Exception as e:
                logger.error(f"Error calculating image pull time: {e}")

        logger.info("Background initialization completed successfully")

    except Exception as e:
        logger.error(f"Error in initialize_background: {e}")
        raise

class OllamaHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status_code=200):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._set_headers()
            self.wfile.write(json.dumps({"status": "healthy"}).encode())
            return
        
        self._set_headers()
        self.wfile.write(json.dumps({"message": "Ollama service is running. Send POST requests with prompts."}).encode())

    def do_HEAD(self):
        self._set_headers()

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length)
        try:

            data = json.loads(body)
            prompt = data.get("prompt", "Hello, World!")
            logger.info(f"Received prompt: {prompt}")

            process = subprocess.Popen(
                [BINARY_PATH, "run", MODEL, prompt],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            output, err = process.communicate()
            logger.info(f"Model output: {output.decode('utf-8')}")
            
            if process.returncode != 0:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": err.decode("utf-8")}).encode())
                return
                
            logger.info("Model responded successfully")
            self._set_headers()
            self.wfile.write(json.dumps({"response": output.decode("utf-8")}).encode())
            
        except Exception as e:
            logger.error(f"Error processing request: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({"error": str(e)}).encode())

def run_server(server_class=HTTPServer, handler_class=OllamaHandler, port=8080): #was 8080 11434
    server_address = ('0.0.0.0', port)
    httpd = server_class(server_address, handler_class)
    logger.info(f"Starting server on port {port}...")

    # Create event loop in the main thread
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # Start initialization in background
    async def start_background():
        try:
            logger.info("Starting background initialization process...")
            await initialize_background()
            logger.info("Background initialization completed")

        except Exception as e:
            logger.error(f"Background initialization error: {e}")

    # Run background initialization in the current event loop
    try:
        # Run the background task
        logger.info("Running background initialization...")
        loop.run_until_complete(start_background())
    except Exception as e:
        logger.error(f"Error during background initialization: {e}")
    finally:
        loop.close()

    # Start serving requests
    try:
        logger.info("Starting HTTP server...")
        httpd.serve_forever()
    except Exception as e:
        logger.error(f"Server error: {e}")

if __name__ == "__main__":
    try:
        logger.info("Starting Ollama server application...")
        run_server()
    except Exception as e:
        logger.error(f"Application error: {e}")
        raise
