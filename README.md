# Vidro Exporta

Back-office local para uma exportadora de copos de vidro, desenvolvido em HTML, CSS, JavaScript e Node.js, com banco de dados SQLite e classes orientadas a objetos.

## Executar

1. Instale o Node.js 22.13 ou superior.
2. Abra a pasta do projeto e execute o arquivo INICIAR.cmd no Windows.
3. Abra [Vidro Exporta](http://127.0.0.1:3000) no navegador.

Também é possível executar pelo terminal, dentro da pasta do projeto.

~~~sh
npm start
~~~

O projeto usa os recursos nativos do Node.js. O primeiro início cria o banco em data/vidro-exporta.sqlite e cadastra seis produtos de exemplo. Cadastre os produtos reais em Catálogo. Para encerrar, pressione Ctrl+C na janela do servidor.

O SQLite nativo pode exibir um aviso de recurso experimental em algumas versões do Node.js 22.

## Fluxos disponíveis

- Escolher entre 13 países de destino e obter o preço na respectiva moeda.
- Atualizar a taxa de referência pelo botão de atualização.
- Buscar produtos por nome, SKU ou categoria.
- Cadastrar, editar, arquivar e reativar produtos.
- Adicionar produtos à cotação e definir quantidades.
- Identificar o cliente, salvar a cotação e consultar seu histórico.
- Imprimir a cotação ou salvar como PDF pelo navegador.

## Regra de preço

A moeda-base escolhida para a empresa é o real brasileiro. A aplicação usa um acréscimo de 100% sobre o custo informado.

~~~text
Venda em BRL = custo em BRL × 2
Venda na moeda de destino = venda em BRL × taxa BRL → moeda de destino
Total da cotação = soma dos preços unitários arredondados × respectivas quantidades
~~~

Por exemplo, um custo de R$ 10,00 resulta em R$ 20,00 de preço-base. Com uma taxa ilustrativa de 0,18 USD por BRL, o preço será US$ 3,60.

Cada moeda usa sua quantidade de casas decimais, incluindo iene e peso chileno. Os cálculos monetários mantêm valores inteiros em centavos ou unidades mínimas, com aritmética decimal exata no arredondamento da conversão.

O custo cadastrado é a referência para o lucro. Frete, impostos, tarifas e despesas cambiais exigem composição própria dos custos para apuração do resultado líquido. A tela e a impressão identificam o escopo dos preços.

## Câmbio

A classe ExchangeService consulta a API Frankfurter v2 com BRL como base e a moeda do destino como cotação. O provedor disponibiliza taxas de referência com data, provenientes de bancos centrais e fontes oficiais. A frequência depende da publicação das fontes. [Documentação Frankfurter](https://frankfurter.dev/)

A aplicação consulta o serviço quando a taxa local vence após uma hora, ao trocar de mercado ou ao clicar em atualizar. A tela de precificação verifica o cache a cada 15 minutos enquanto estiver visível e sem formulários abertos.

O banco persiste a data e a taxa recebidas. Em uma falha externa, a aplicação usa a última taxa salva e apresenta um aviso com a data. Sem uma taxa salva, o modo de demonstração apresenta taxas ilustrativas com identificação visível. O histórico e a impressão também registram essa identificação.

Para exigir uma taxa externa ou previamente armazenada, desative as taxas de demonstração no PowerShell antes de iniciar.

~~~powershell
$env:ALLOW_DEMO_RATES = '0'
npm start
~~~

## Organização

~~~text
frontend/
  index.html       Interface e formulários acessíveis
  styles.css       Layout responsivo
  app.js           Controlador BackOffice e cliente HTTP Api
  glass.png        Imagem ilustrativa de copos
backend/
  server.js        Servidor HTTP, rotas REST e validação das entradas
  pricing.js       PricingService, ExchangeService e configuração dos destinos
  store.js         Classe Store e persistência SQLite
app.test.js        Testes automatizados de cálculo e integração HTTP
data/              Banco criado automaticamente em execução
~~~

As camadas se comunicam por requisições HTTP com JSON. O Node.js também entrega os arquivos estáticos do front-end na mesma origem.

As classes Store, ExchangeService e PricingService separam persistência, consulta cambial e regras de negócio. A classe BackOffice coordena as telas e usa Api para as requisições.

## API

| Método | Endereço | Operação |
| --- | --- | --- |
| GET | /api/markets | Países e moedas disponíveis |
| GET | /api/products | Catálogo completo |
| POST | /api/products | Cadastro de produto |
| PUT | /api/products/:id | Edição de produto |
| PATCH | /api/products/:id | Arquivamento ou ativação |
| GET | /api/prices?country=US | Preços convertidos |
| GET | /api/prices?country=US&refresh=1 | Consulta de câmbio atualizada |
| GET | /api/quotes | Histórico de cotações |
| GET | /api/quotes/:id | Detalhes de uma cotação |
| POST | /api/quotes | Cálculo e gravação de uma cotação |

Exemplo de produto em JSON.

~~~json
{
  "sku": "VE-007",
  "name": "Copo Horizonte",
  "category": "Long drink",
  "capacity": 400,
  "costCents": 1000,
  "style": "highball"
}
~~~

O endpoint de cotação recebe customer, countryCode, rate, rateDate, source e items. Cada item contém id, quantity e unitMinor, obtidos na resposta da precificação. O servidor calcula o preço novamente a partir do banco e confere os valores apresentados. Em alterações de preço ou câmbio, retorna HTTP 409 para revisão.

Uma transação grava todos os itens e seus valores históricos. Alterações posteriores no catálogo e nas taxas preservam os valores da cotação gravada. O front-end envia requestKey para que a repetição de uma tentativa com a mesma chave e os mesmos dados retorne a cotação já criada. Clientes de API podem enviar uma chave UUID para obter esse comportamento.

## Configurações

| Variável | Padrão | Uso |
| --- | --- | --- |
| PORT | 3000 | Porta HTTP local |
| DATABASE_FILE | data/vidro-exporta.sqlite | Caminho alternativo do banco |
| SEED_DEMO | 1 | Use 0 no primeiro início de um banco novo para criar catálogo vazio |
| ALLOW_DEMO_RATES | 1 | Use 0 para exigir taxas externas ou salvas |

O servidor aceita acesso pelo próprio computador e aplica validação de origem, consultas SQL parametrizadas, limites de entrada e política de conteúdo. A entrega atende ao uso local. Uma implantação compartilhada exige autenticação, controle de acesso, HTTPS e configuração de hospedagem.

Para preservar os dados, encerre o servidor e copie o arquivo data/vidro-exporta.sqlite para um local de backup. O arquivo ZIP de distribuição contém os fontes e cria seu próprio banco no primeiro início.

## Verificação

Execute os testes dentro da pasta do projeto.

~~~sh
npm test
~~~

A suíte cobre markup, arredondamento, cache, indisponibilidade do provedor, concorrência na consulta, CRUD, validação HTTP, histórico e alterações de preço ou taxa durante a criação da cotação.

A consulta cambial nos testes é controlada para que os resultados sejam reproduzíveis. A validação do serviço externo depende de acesso à internet durante a execução da aplicação.

Na entrega, os 15 testes automatizados passaram. Os fluxos do front-end também foram exercitados em um DOM de teste, incluindo cadastro, arquivamento, busca, mudança de moeda e criação de cotação. A consulta cambial real foi validada. A conferência visual no navegador ficou pendente após um bloqueio da ferramenta de automação durante a verificação da URL.
