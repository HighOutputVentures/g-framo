import assert from 'assert';
import yaml from 'js-yaml';
import path from 'path';
import fs, { readdirSync } from 'fs';

export type Dictionary<T> = { [key: string]: T };

export type LoadModule = {
  name: string;
  of: string | string[];
}

export type ModuleConfig = {
  version: number;
  dependencies: {
    name: string;
    of: string;
  }[];
  name: string;
}

export type Deployment = {
  type: string;
  name: string;
  of: string | string[];
  description?: string;
  modules: (string | LoadModule)[];
  template?: string;
  load?: string[];
}

export type DeploymentConfig<T extends Deployment> = {
  version: number;
  templates?: Dictionary<T | Deployment>;
  deployment: (Deployment | T)[];
}

export interface Runner<T, M> {
  type: string;
  onLoad: (module: M, deployment?: T) => Promise<void> | void;
  run: () => Promise<void>;
}


function toArray<T>(arr: T | T[]) {
  return Array.isArray(arr) ? arr : [arr];
}

export default class <D extends Deployment> {
  private config: DeploymentConfig<D> | null = null;

  private configCache = new Map<string, ModuleConfig>();

  private runnerCache = new Map<string, Runner<D, any>>();

  private modulePathCache = new Map<string, string>();

  constructor(private modulesPath: string, private configPath: string) {
    this._loadConfig();
    this._loadConfigCache();
  }

  public addRunner(runner: any) {
    this.runnerCache.set(runner.type, runner);
    return this;
  }

  private _loadConfigCache() {
    const modules = readdirSync(this.modulesPath, { withFileTypes: true })
      .filter((ent) => ent.isDirectory())
      .map((ent) => ent.name);
    
    for (const module of modules) {
      const modulePath = path.join(this.modulesPath, module);
      const config = yaml.load(fs.readFileSync(path.join(modulePath, 'config.yml'), 'utf8')) as ModuleConfig;

      // Ensure that there is no conflicting config names
      const hit = this.configCache.get(config.name);
      assert(!hit, `Module ${config.name} conflict, already found at ${modulePath}`);

      this.configCache.set(config.name, config);
      this.modulePathCache.set(config.name, path.join(this.modulesPath, module));
    }
  }

  private _loadConfig() {
    const config = yaml.load(fs.readFileSync(this.configPath, 'utf8')) as DeploymentConfig<D>;

    config.deployment = config.deployment.map((service) => {
      const { template } = service;
      if (template) {
        assert(config.templates, `No template defined, but found a referencing template ${template}`);
        assert(config.templates[template], `Expected template ${template} to be defined on the templates.`);
  
        return {
          ...service,
          ...config.templates[template],
        }
      }
  
      return service;
    });

    this.config = config;
  }

  private _moduleName(module: string | { name: string }) {
    return typeof module === 'string' ? module : module.name;
  }

  private _getLoadedCommand(deployment: Deployment, module: (string | LoadModule)) {
    if (typeof module === 'string') {
      return toArray(deployment.of);
    }
    
    return toArray(module.of);    
  }

  private _verifyDependencies() {
    assert(this.config);
    assert(this.configCache.size, 'Expected that config cache has already been loaded.');

    const loadedCommands = new Map<string, Set<string>>();

    for (const deployment of this.config.deployment) {
      for (const module of deployment.modules) {
        let cached = loadedCommands.get(this._moduleName(module))
        if (!cached) {
          cached = new Set();
          loadedCommands.set(this._moduleName(module), cached);
        }

        this._getLoadedCommand(deployment, module)
          .forEach((command) => cached!.add(command));
      }
    }

    for (const deployment of this.config.deployment) {
      for (const module of deployment.modules) {
        const name = this._moduleName(module);

        const config = this.configCache.get(name);
        assert(config);

        if (!config.dependencies || !config.dependencies.length) {
          continue;
        }

        for (const dependency of config.dependencies) {
          const cached = loadedCommands.get(this._moduleName(dependency.name));
          const dependentCommands = toArray(dependency.of);
          for (const dependentCommand of dependentCommands) {
            assert(cached && cached.has(dependentCommand), `Expected module ${dependency.name} command ${dependentCommand} to be loaded.`);
          }
        }
      }
    }
  }

  public async run(name: string, verify: boolean) {
    if (verify) {
      this._verifyDependencies();
    }

    assert(this.config);
    this.configCache.clear();
    
    for (const deployment of this.config.deployment) {
      if (deployment.name === name) {
        const runner = this.runnerCache.get(deployment.type);
        assert(runner);
        this.runnerCache.clear();

        for (const module of deployment.modules) {
          let toLoad = toArray(deployment.of);

          if (typeof module !== 'string') {
            toLoad = toArray(module.of);
          }

          for (const load of toLoad) {
            const modulePath = this.modulePathCache.get(this._moduleName(module));
            assert(modulePath);
            await runner.onLoad(
              require(path.join(modulePath, load.toLowerCase())),
              deployment as D,
            );
          }
        }
        
        await runner.run();
        this.modulePathCache.clear();
        return;
      }
    }
  }
}