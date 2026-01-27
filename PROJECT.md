# env-manager

utility to manage my own environment variables for all my personal projects

## Features

1. define environment schema per project

    schema + defaults are embedded as comments in the `.env` file. format: `# {optional?, type?}`. example:

    ```
    FOO= # {optional float}
    # {string}
    BAR='some defaut value'
    API_KEY= # {string:format(/^openai-key_\w+/)}
    PORT= {int:min(3000),max(10000)}
    ```

2. store projects in aws secrets manager (both schema and data)
3. cli script

    3.1. env-manager up [-p --project=basename cwd] # uploads the current `.env` and the values from `.env.local`

    3.2. env-manager down [-p --project=basename cwd] # syncs both `.env` and `.env.local`
