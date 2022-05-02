# Framo
Framo is a barebone and extensible framework for modular 
projects. Framo has 3 parts, the `Module`, `Runner`, and the `Deployment Template`.


## Module
Basically this is where you put in your logics for the module. Each module should have a `config.yml` file that defines the name of the module and it's
dependencies.

***Example***:

`modules/account/config.yml`
```yml
version: 1

name: Account

dependencies:
  - name: Member
    of:
      - Query
```

Here it declares that the name of the module is `Account` and have a dependency of `Member` with the command `Query` has been loaded. When this module will loaded under `modules` in `Deployment Template`, it will reference it by `Account` not `account(filename)`.

---

Each modules will compose of folders that will be used by the runners upon importing.
Folder names will be mapped by the lowercase of the `of` in the deployment.

***Example***:

```yml
deployment:
  - type: GraphQL
    name: BE
    of: Endpoint
    modules:
      - Account
      - Report
    ...
```

Upon importing the module(in `modules`), it will look for the folder `endpoint`, and import the `index.ts` or `index.js` that will be supplied to the `Runner`.

## Runner
Runners are defined outside of this library that will be used to handle any imported module configuration. In `Deployment Template`, runners are defined in `type`. These are `class/objects/functions` that implements the following methods:

* `type`: This defines as to what `type` on the `Deployment Template` it will handle.
* `onLoad`: This is a function that will be called everytime whenever the module's command `of` will be `loaded/imported`.
* `run`: Once all module commands has been loaded, it will call the `run` function. Ideally, this is the place where you launch the servers like `express`, `graphql`, `koa`, etc..

***Here is an example***:

`Deployment Template`
```yml
deployment:
  - type: GraphQL
```

`Runner`
```typescript
import { ApolloServer, makeExecutableSchema } from 'apollo-server-koa';
import Koa from 'koa';
import { mergeTypeDefs } from '@graphql-tools/merge';
import { loadFilesSync } from '@graphql-tools/load-files';
import { createServer } from 'http';

import { Runner, Deployment, Dictionary } from './../lib/types';

export type GraphQLDeploymentRunner = Deployment & { type: 'GraphQL' };
export type ModuleImport = {
  schemas: string[];
  loaders: (() => () => any)[];
  resolvers: Dictionary<any>;
  middlewares: any[];
  directives: Dictionary<any>;
};

export default class GraphQLRunner implements Runner<GraphQLDeploymentRunner, ModuleImport> {
  private modules = {
    schemas: [],
    loaders: [],
    resolvers: {},
    middlewares: [],
    directives: {},
  };

  /**
   * Handle all GraphQL type deployment
   */
  public get type() {
    return 'GraphQL';
  }

  /**
   * Keep track of all the modules that is being imported.
   */
  onLoad (module: ModuleImport) {
    Object.keys(this.modules).map((key) => {
      if (Array.isArray(this.modules[key])) {
        Array.prototype.push.apply(this.modules[key], module[key]);
        return;
      }
      
      this.modules[key] = {
        ...this.modules[key],
        ...module[key],
      };
    });
  }

  /**
   * Start the GraphQL Server
   */
  async run () {
    const app = new Koa();
    const apollo = new ApolloServer({
      schema: makeExecutableSchema({
        typeDefs: mergeTypeDefs(
          loadFilesSync(this.modules.schemas, { recursive: true }),
        ),
        resolvers: this.modules.resolvers,
      }),
    });

    apollo.applyMiddleware({ app });
    createServer(app.callback()).listen(8000);
  }
}

```

## Deployment Template
Config template contains all the information about the deployments.

***Example***:
```yml
version: 1.0
name: UniWallet

templates:
  Wallet:
    modules:
      - Deposits
      - Withdrawals
      - Banks

deployment:
  - type: GraphQL
    name: Account
    of: Graphql
    modules:
      - Account
      - Member
      - PaymentMethod
  - type: Rest
    template: Wallet
```

***Properties***

* `version(optional)`:
* `name(optional)`:
* `templates(optional)`: These are reference to the values that you can use under `deployment`. Instead of re-writing them for each deployment, `templates` can be used instead.
  
* `deployment`: Contains the modules, and type of deployment will be executed. It compose of the following properties:
  * `type`: This determines as to what kind of `Runner` will be used to execute a deployment.
  * `name`: The name(defined in `config.yml`) of the deployment, that contains a set of modules to be executed.
  * `of`: The default command to be loaded on the modules being defined below.
  * `modules`: This contains all the list as to what modules will be loaded.

## API

**`Constructor (modulePath: string, configPath: string)`**:

Creates an instance of Deployment, with the supplied `modulePath` and `configPath` for the deployment.


**`run(deployment: string, verify: boolean = true)`**:

Load the modules, verify depndencies and executes the `Runner`.`run`.


***Example***:
```typescript
import path from 'path';

import Deployment from './lib/deployment';
import GraphQLRunner from './runner/graphql';
import RestRunner from './runner/rest';

async function main() {
  const deployment = new Deployment(
    path.join(__dirname, 'module'),
    path.join(__dirname, 'deployments.yml'),
  )
    .addRunner(new GraphQLRunner())
    .addRunner(new RestRunner());
  
  await deployment.run('APISite');
}

main();
```

This is what the ideal root project tree structure would look like.

```
.
├── index.ts
└── modules
    ├── account
    │   ├── config.yml
    │   ├── graphql
    │   │   └── index.ts
    │   ├── grpc
    │   │   └── index.ts
    │   └── rest
    │       └── index.ts
    └── report
        ├── config.yml
        ├── graphql
        │   └── index.ts
        ├── grpc
        │   └── index.ts
        └── rest
            └── index.ts
```