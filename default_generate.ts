/* const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const templatesDir = path.join(__dirname, 'templates');
const outputDir = path.join(__dirname, 'src/modules');
const schemaPath = path.join(__dirname, 'prisma/schema.prisma');
const appModulePath = path.join(__dirname, 'src/shared/app.module.ts');

const entityName = process.argv[2];

if (!entityName) {
    console.error('Por favor, forneça o nome da entidade.');
    process.exit(1);
}

// Função para formatar o nome da entidade com a primeira letra maiúscula e as demais minúsculas
const formatEntityName = (name) => {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
};

const entityNameLower = entityName.charAt(0).toLowerCase() + entityName.slice(1).toLowerCase();
const entityNameFormatted = formatEntityName(entityName);

// Função para substituir os espaços reservados nos arquivos de template
const replacePlaceholders = (template, name) => {
    return template
        .replace(/{{name}}/g, name)
        .replace(/{{name-lower}}/g, name.charAt(0).toLowerCase() + name.slice(1).toLowerCase());
};

// Função para gerar o arquivo com base no template
const generateFile = (templatePath, outputPath, name) => {
    const template = fs.readFileSync(templatePath, 'utf8');
    const content = replacePlaceholders(template, name);
    fs.writeFileSync(outputPath, content, 'utf8');
};

// Função para remover um diretório e seu conteúdo
const removeDirRecursive = (dirPath) => {
    if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                removeDirRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(dirPath);
    }
};

// Função para ler o schema.prisma e verificar se o modelo existe
const modelExists = (schemaPath, modelName) => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const modelRegex = new RegExp(`model\\s+(${modelName.toLowerCase()})\\s+{`, 's');
    return modelRegex.test(schema);
};

// Função para ler o schema.prisma e extrair o modelo
const extractModel = (schemaPath, modelName) => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const modelRegex = new RegExp(`model\\s+(${modelName.toLowerCase()})\\s+{([^}]*)}`, 's');
    const match = schema.match(modelRegex);
    if (match) {
        return match[2].trim();
    } else {
        console.error(`Modelo ${modelName} não encontrado em ${schemaPath}`);
        process.exit(1);
    }
};

const extractRelations = (modelContent) => {
    // Ajuste da regex para capturar relações simples e em arrays sem @relation
    const relationRegex = /(\w+)\s+(\w+)\s*@relation\(([^)]*)\)|(\w+)\s+(\w+)\[\]/g;
    const relations = {};
    let match;
    while ((match = relationRegex.exec(modelContent)) !== null) {
        const [, fieldName, relatedModel, , fieldArrayName, relatedArrayModel] = match;

        if (relatedModel) {
            if (!relations[relatedModel]) {
                relations[relatedModel] = [];
            }
            relations[relatedModel].push({ field: fieldName });
        }

        if (relatedArrayModel) {
            if (!relations[relatedArrayModel]) {
                relations[relatedArrayModel] = [];
            }
            relations[relatedArrayModel].push({ field: fieldArrayName });
        }
    }
    return relations;
};

// Mapeamento de tipos Prisma para tipos TypeScript
const prismaTypeToTSType = (prismaType) => {
    const typeMap = {
        'Int': 'number',
        'Float': 'number',
        'Decimal': 'number',
        'Boolean': 'boolean',
        'String': 'string',
        'DateTime': 'Date',
        'Json': 'any',
        'Bytes': 'Buffer',
        'BigInt': 'bigint'
        // Adicione outros mapeamentos conforme necessário
    };
    return typeMap[prismaType] || prismaType;
};

// Função para gerar DTOs com base no modelo
const generateDTOs = (modelContent, outputDir) => {
    const fields = modelContent.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//') && !line.startsWith('@@') && !line.includes('@relation(')) // Filtrar linhas com @relation(
        .map(line => {
            const [name, type] = line.split(/\s+/).filter(part => part.trim() !== '');

            // Ignore the field if it's 'id' or if it's an array type
            if (!name || !type || type.includes('[]') || name.toLowerCase() === 'id') return null;

            // Determine TypeScript type
            const fieldName = name.toLowerCase();
            const cleanType = type.replace(/\?.*$/, '').trim();
            const isOptional = type.includes('?');

            let tsType;
            let validationDecorator = '';

            if (cleanType === 'DateTime') {
                tsType = 'Date';
                validationDecorator = '@IsOptional()\n  @IsDate()';
            } else {
                tsType = prismaTypeToTSType(cleanType);
                validationDecorator = isOptional ? '@IsOptional()' : '@IsNotEmpty()';
            }

            return `  ${validationDecorator}\n  ${fieldName}${isOptional ? '?' : ''}: ${tsType};`;
        })
        .filter(Boolean)
        .join('\n\n');

    const createDtoTemplate = `import { IsNotEmpty, IsOptional, IsDate } from 'class-validator';

export class Create{{name}}Dto {
{{fields}}
}
`;

    const updateDtoTemplate = `import { IsNotEmpty, IsOptional, IsDate } from 'class-validator';

export class Update{{name}}Dto {
{{fields}}
}
`;

    const createDtoContent = createDtoTemplate
        .replace(/{{name}}/g, entityNameFormatted)
        .replace('{{fields}}', fields);

    const updateDtoContent = updateDtoTemplate
        .replace(/{{name}}/g, entityNameFormatted)
        .replace('{{fields}}', fields);

    fs.mkdirSync(path.join(outputDir, 'dto'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'dto', `create-${entityNameLower}.dto.ts`), createDtoContent, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'dto', `update-${entityNameLower}.dto.ts`), updateDtoContent, 'utf8');
};

// Função para gerar o arquivo da entidade
const generateEntityFile = (modelContent, outputDir) => {
    const fields = modelContent.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//') && !line.startsWith('@@') && !line.includes('@relation(')) // Filtrar linhas com @relation(
        .map(line => {
            const [name, type] = line.split(/\s+/).filter(part => part.trim() !== '');

            // Ignore the field if it's 'id' or if it's an array type
            if (!name || !type || type.includes('[]') || name.toLowerCase() === 'id') return null;

            // Determine TypeScript type
            const fieldName = name.toLowerCase();
            const cleanType = type.replace(/\?.*$/, '').trim();
            const isOptional = type.includes('?');

            let tsType;
            if (cleanType === 'DateTime') {
                tsType = 'Date';
            } else {
                tsType = prismaTypeToTSType(cleanType);
            }

            return `  ${fieldName}${isOptional ? '?' : ''}: ${tsType};`;
        })
        .filter(Boolean)
        .join('\n');

    const entityTemplate = `export class ${entityNameFormatted} {
${fields}
}
`;

    fs.mkdirSync(path.join(outputDir, 'entity'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'entity', `${entityNameLower}.entity.ts`), entityTemplate, 'utf8');
};

// Função para gerar o arquivo de serviço
const generateServiceFile = (modelContent, outputDir) => {
    const relations = extractRelations(modelContent);

    let includes = '';
    for (const [relatedModel] of Object.entries(relations)) {
        includes += `${relatedModel}: true,`;
    }
    const serviceTemplate = includes ?
        //Service com includes
        `import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { Create{{name}}Dto } from './dto/create-{{name-lower}}.dto';
import { Update{{name}}Dto } from './dto/update-{{name-lower}}.dto';

@Injectable()
export class {{name}}Service {
  constructor(private readonly prisma: PrismaService) { }

  create(create{{name}}Dto: Create{{name}}Dto) {
    return this.prisma.{{name-lower}}.create({ data: create{{name}}Dto });
  }

  findAll() {
    return this.prisma.{{name-lower}}.findMany({
      include: {
        ${includes}
      }
    });
  }

  findOne(id: number) {
    return this.prisma.{{name-lower}}.findUnique({
      where: { id: id },
      include: {
        ${includes}
      }
    });
  }

  update(id: number, update{{name}}Dto: Update{{name}}Dto) {
    return this.prisma.{{name-lower}}.update({ where: { id: id }, data: update{{name}}Dto });
  }

  remove(id: number) {
    return this.prisma.{{name-lower}}.delete({ where: { id: id } });
  }
}
`:
        //Service sem includes
        `import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { Create{{name}}Dto } from './dto/create-{{name-lower}}.dto';
import { Update{{name}}Dto } from './dto/update-{{name-lower}}.dto';

@Injectable()
export class {{name}}Service {
  constructor(private readonly prisma: PrismaService) { }

  create(create{{name}}Dto: Create{{name}}Dto) {
    return this.prisma.{{name-lower}}.create({ data: create{{name}}Dto });
  }

  findAll() {
    return this.prisma.{{name-lower}}.findMany();
  }

  findOne(id: number) {
    return this.prisma.{{name-lower}}.findUnique({ where: { id: id } });
  }

  update(id: number, update{{name}}Dto: Update{{name}}Dto) {
    return this.prisma.{{name-lower}}.update({ where: { id: id }, data: update{{name}}Dto });
  }

  remove(id: number) {
    return this.prisma.{{name-lower}}.delete({ where: { id: id } });
  }
}`;

    const serviceContent = serviceTemplate
        .replace(/{{name}}/g, entityNameFormatted)
        .replace(/{{name-lower}}/g, entityNameLower);

    fs.writeFileSync(path.join(outputDir, `${entityNameLower}.service.ts`), serviceContent, 'utf8');
};

// Função para atualizar o app.module.ts
const updateAppModule = (appModulePath, entityNameFormatted, entityNameLower) => {
    let appModuleContent = fs.readFileSync(appModulePath, 'utf8');

    // Adiciona o import do módulo no topo do arquivo
    const importStatement = `import { ${entityNameFormatted}Module } from '../modules/${entityNameLower}/${entityNameLower}.module';`;
    if (!appModuleContent.includes(importStatement)) {
        appModuleContent = importStatement + '\n' + appModuleContent;
    }

    // Adiciona o módulo no array de imports
    const importsArrayRegex = /imports:\s*\[([^\]]*)\]/s;
    const match = appModuleContent.match(importsArrayRegex);
    if (match) {
        let importsArrayContent = match[1];
        if (!importsArrayContent.includes(`${entityNameFormatted}Module`)) {
            importsArrayContent = importsArrayContent.trim() + `,\n    ${entityNameFormatted}Module`;
            appModuleContent = appModuleContent.replace(importsArrayRegex, `imports: [${importsArrayContent}\n  ]`);
        }
    }

    fs.writeFileSync(appModulePath, appModuleContent, 'utf8');
};

// Verificar se o modelo existe no schema.prisma
if (!modelExists(schemaPath, entityName)) {
    console.error(`Modelo ${entityName} não encontrado em ${schemaPath}`);
    process.exit(1);
}

// Caminhos dos templates
const controllerTemplate = path.join(templatesDir, 'controller.template.txt');
const moduleTemplate = path.join(templatesDir, 'module.template.txt');

// Caminhos de saída
const moduleDir = path.join(outputDir, `${entityNameLower}`);
const controllerOutput = path.join(moduleDir, `${entityNameLower}.controller.ts`);
const moduleOutput = path.join(moduleDir, `${entityNameLower}.module.ts`);

// Remover o diretório do módulo se existir
removeDirRecursive(moduleDir);

// Criação do diretório
fs.mkdirSync(moduleDir, { recursive: true });

// Gerar o módulo, serviço e controlador usando os comandos Nest
execSync(`nest generate module ${entityNameLower}`, { stdio: 'inherit', cwd: path.join(__dirname, 'src/modules') });
execSync(`nest generate service ${entityNameLower}`, { stdio: 'inherit', cwd: path.join(__dirname, 'src/modules') });
execSync(`nest generate controller ${entityNameLower}`, { stdio: 'inherit', cwd: path.join(__dirname, 'src/modules') });

// Gerar arquivos de template personalizados
generateFile(controllerTemplate, controllerOutput, entityNameFormatted);
generateServiceFile(extractModel(schemaPath, entityName), moduleDir);

// Gerar DTOs e entidade
const modelContent = extractModel(schemaPath, entityName);
generateDTOs(modelContent, moduleDir);
generateEntityFile(modelContent, moduleDir);

// Gerar o módulo com os providers e controllers
const moduleContent = `
import { Module } from '@nestjs/common';
import { ${entityNameFormatted}Controller } from './${entityNameLower}.controller';
import { ${entityNameFormatted}Service } from './${entityNameLower}.service';
import { PrismaService } from '../../shared/services/prisma.service'; 

@Module({
  controllers: [${entityNameFormatted}Controller],
  providers: [${entityNameFormatted}Service, PrismaService],
})
export class ${entityNameFormatted}Module {}
`;

fs.writeFileSync(moduleOutput, moduleContent, 'utf8');

// Atualizar app.module.ts
updateAppModule(appModulePath, entityNameFormatted, entityNameLower);

console.log(`Módulo, Controller, Service, DTOs e Entity para ${entityNameFormatted} gerados e ajustados com sucesso.`);
 */