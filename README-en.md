# Stepfun Realtime Console

[中文](README.md) | English

## Project Description

This is a frontend demo project based on the Stepfun Realtime Voice API, used to showcase and test Stepfun's realtime voice conversation features. Through this project, users can experience realtime voice interaction and related function debugging and testing. The project provides a user-friendly interface, making it easy for developers and testers to quickly get started and understand the various functions and features of the Stepfun Realtime API.

## Key Features

- **Realtime Voice Interaction**: Supports realtime voice input and output, enabling a smooth human-machine conversation experience.
- **Visualized Audio Waveform**: Uses WaveSurfer.js to visualize the audio waveform.
- **Custom AI Persona**: Allows customization of AI instructions and persona to adjust the conversation style.
- **Debug Logs**: Provides detailed debug logs to help developers track API calls and responses.

## Technology Stack

- **Frontend Framework**:
  - Svelte 5 - Reactive frontend framework
  - SvelteKit - Server-side rendering (SSR) framework based on Svelte, similar to Next.js and Nuxt.js, providing routing, server-side rendering, and API endpoints.
- **Styling**: Tailwind CSS 4 - Utility-first CSS framework
- **UI Components**: DaisyUI - Component library based on Tailwind CSS
- **Audio Processing**: WaveSurfer.js - Audio visualization library
- **Build Tool**: Vite - Modern frontend build tool
- **Runtime**: Bun - High-performance JavaScript runtime
- **Language**: TypeScript - Type-safe JavaScript superset
- **WebSocket**: Bun native WebSocket - Used for realtime communication

## Installation and Usage

### Prerequisites

- Install Bun runtime (required, due to the use of Bun native WebSocket, it is not compatible with Node.js)

### Installation Steps

1.  Install Bun runtime:

    ```bash
    npm install -g bun
    ```

2.  Clone the project and enter the project directory:

    ```bash
    git clone https://github.com/stepfun-ai/Step-Realtime-Console
    cd Step-Realtime-Console
    ```

3.  Install project dependencies:

    ```bash
    bun install
    ```

4.  Run the development server:

    ```bash
    bun dev
    ```

    The project will run on port 5173 (ports will increment sequentially if occupied), and the WebSocket relay service will run on port 8080. Ensure that these ports are not occupied by other applications. Please note the actual port information in the console output.

5.  Access in the browser:
    ```
    http://localhost:5173
    ```

### Build Production Version

```bash
bun run build
```

The built files will be located in the `build` directory. You can start the service via `bun build/`, note that the final `/` cannot be omitted. The complete version of this command is actually `bun build/index.js`. The service will run on port 3000.

If you want to customize the service port, you can do so via environment variables, for example, `PORT=3001 bun build/`, then the service will run on port 3001.

## First-Time Use Instructions

### First Load During Development

The first page load during development may be slower because the project uses the Lucide icon library, which takes a long time to process during the first compilation. This is normal, please be patient. This situation only occurs during development; the production version will not have this issue.

### Configure Service

After successfully running the project, you need to click the **Server Settings** button in the interface and configure the following information:

1.  **Server Address**: wss://api.stepfun.com/v1/realtime

2.  **Model Name**: Currently supports four versions of models: step-audio-2, step-audio-2-mini, step-audio-2-think, step-audio-2-mini-think

3.  **API Key**: You need to obtain the API key through the Stepfun Open Platform. Please visit [Stepfun Open Platform](https://platform.stepfun.com/) to register and get your API Key.

4.  **Voice**: Voice tone setting (required). Please fill in the voice value you want to use, for example: qingchunshaonv, wenrounansheng, etc.

After filling in, you can start experiencing the realtime voice interaction function.

## Project Structure

```
realtime-console-demo/
├── src/                    # Source code directory
│   ├── lib/                # Library files
│   │   ├── openai-realtime-api-beta/  # Modified version of openai's realtime voice sdk for easy management of realtime voice events
│   │   ├── wavtools/       # Audio processing tools
│   │   └── ...             # Other tools and components
│   ├── routes/             # Page routes
│   │   ├── +layout.svelte  # Layout component
│   │   └── +page.svelte    # Main page component
│   ├── app.css             # Global styles
│   ├── app.html            # HTML template
│   └── hooks.server.ts     # Server hooks, used to start the Bun WebSocket server and relay WebSocket connections
├── static/                 # Static resources
├── build/                  # Build output directory
├── package.json            # Project configuration
├── svelte.config.js        # Svelte configuration
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite configuration
└── README.md               # Project description
```

## WebSocket Relay Instructions

This project uses a server to relay WebSocket connections to communicate with the Stepfun Realtime API. This is because the browser's native WebSocket does not support transmitting information in the headers field, while the Stepfun Realtime API needs to transmit the user's API Key in the header for authentication.

In the `hooks.server.ts` file, we implement a middleware server for:

1.  Receiving WebSocket connections from the frontend
2.  Creating a new WebSocket connection to the Stepfun Realtime API server and adding the API Key in the header
3.  Forwarding messages between the two WebSocket connections

**Security Recommendation**: In actual development, it is strongly recommended that developers also use a similar middleware server method to relay WebSocket connections, avoiding the direct use of the API Key in the frontend, thereby reducing the risk of API Key exposure. This method can effectively protect the user's API Key security and prevent malicious use.

## About openai-realtime-api-beta

The `openai-realtime-api-beta` directory used in this project is a modified version based on the realtime voice SDK provided by OpenAI (original repository: [https://github.com/openai/openai-realtime-api-beta](https://github.com/openai/openai-realtime-api-beta)). Stepfun is committed to co-building an ecosystem with other AI vendors, so it adopts API interface specifications compatible with OpenAI.

Since OpenAI's library has not been updated since December 2024, and some model information is fixed in a hard-coded manner, in order to meet our development needs, we put it into this repository and made appropriate modifications to support Stepfun's realtime voice API features.

We thank OpenAI for providing the original SDK, and we also welcome developers to further customize and optimize based on our modified version.

## API Usage Instructions

This project uses the Stepfun Realtime Voice API, and the main functions include:

1.  **Establish WebSocket Connection**: Connect to the Stepfun Realtime API server
2.  **Voice Input**: Supports realtime voice input, automatically transcribed into text
3.  **AI Response**: Get AI's realtime text and voice responses

### Main API Parameters

- **Model Name**: Select different AI models
- **Voice**: Set AI voice tone (required)
- **System Prompt**: Customize AI behavior and overall instructions

## Precautions

1.  **Bun Runtime**: This project uses Bun's native WebSocket, so it is not compatible with the Node.js environment and must be run with Bun.
2.  **Bun Version**: Ensure your Bun version is above 1.2, if not, please upgrade via `bun upgrade`
3.  **API Key**: You need to configure a valid API key before use.
4.  **Audio Device**: Please ensure that microphone permissions have been granted to the browser when using it.

## Third-Party Library Copyright Notice

### wavesurfer.js

BSD 3-Clause License

Copyright (c) 2012-2023, katspaugh and contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

- Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
