# Business Rules (RASCUNHO — não usado)

Frete e pagamento por Business Rules da Nuvemshop **ainda não foram aprovados**. Nada aqui está
registrado no install, não há rota, tabela nem escopo pedindo isso. Não importe estes arquivos
em código de produção até a homologação sair.

Quando for aprovado:
1. Migration no `atacarejo-db` com `store_shipping_options` / `store_payment_options` (espelho das opções da loja).
2. Sync das opções no install (`GET shipping_carriers/options`, `GET payment_providers/options`) — em transação.
3. Rotas `POST /api/callbacks/shipping` e `/api/callbacks/payments` usando `isWholesaleCart` (lib/wholesale/eligibility.ts) + as funções abaixo.
4. Registrar no install: `PUT business_rules/integrations/shipping` (`shipping/before-filter`) e `.../payments` (`payments/before-filter`).
5. Novos escopos: `read_shipping`, `read_payment_options`, `read_payments`. Rever o checklist de homologação de apps de frete/pagamento.
