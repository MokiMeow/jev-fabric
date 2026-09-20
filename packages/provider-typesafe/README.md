# @mokimeow/jev-fabric-provider-typesafe

TypeSafe AI and fixed Vercel AI Gateway advisory provider adapter for [Jev Fabric](https://github.com/MokiMeow/jev-fabric).

## Install

`npm install @mokimeow/jev-fabric-provider-typesafe`

## Use

Import `createNativeJevProvider` for the direct route or `createVercelGatewayJevProvider` for the fixed TypeSafe-compatible Gateway route, and pass credentials only through your host secret manager.

Live calls require the runtime/CLI explicit `--live` controls; never commit or log API keys.

Read the [repository documentation](https://github.com/MokiMeow/jev-fabric/tree/main/docs), [security boundary](https://github.com/MokiMeow/jev-fabric/tree/main/docs/security), and [Apache-2.0 license](https://github.com/MokiMeow/jev-fabric/blob/main/LICENSE). Requires Node.js >=22.14 and <25.
