# LiteLLM 1.100.0 gateway compatibility

This experiment keeps LiteLLM Router as the provider alias, retry, tool-message, and backend replacement owner. A narrow ASGI wrapper adds the missing shared provider admission boundary: two active requests across `flash` and `pro`, 32 pending requests, one absolute 2.5 second deadline across queue and all Router attempts, and cancellation of the in-flight request task on ASGI disconnect.

The build pins the released image by digest and changes one CLI app target to the wrapper. The wrapper does not inspect or rewrite the JSON payload. Its five-second total deadline leaves room for two LiteLLM Retry-After backoffs while bounding a ten-second provider request. The configs contain mock credentials only.

Run the complete controlled admission suite:

```sh
./run.sh
```

The script starts only uniquely named task containers and one loopback mock process, records lower-backend start/end/cancel events, and removes those services on exit.
