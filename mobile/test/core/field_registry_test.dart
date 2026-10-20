/// O registro traduz — e não decide.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
import 'package:orbit_operator/core/contracts/mobile_signature_contracts.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';

void main() {
  group('impedimentos de execução', () {
    test('auxiliar recebe a frase do papel, não a de permissão', () {
      /// O servidor passou a distinguir os dois motivos. Dizer "falta
      /// permissão" ao auxiliar o mandaria pedir um acesso que ele já tem.
      final frase = executionBlockerLabel('AUXILIARY_TECHNICIAN_READ_ONLY');
      expect(frase, contains('acompanha'));
      expect(frase, isNot(contains('permissão')));
    });

    test('os códigos que já chegavam deixaram de cair no genérico', () {
      for (final codigo in [
        'EXECUTION_PERMISSION_REQUIRED',
        'FIELD_ASSIGNMENT_REQUIRED',
      ]) {
        expect(
          executionBlockerLabel(codigo),
          isNot('Execução indisponível no momento.'),
          reason: codigo,
        );
      }
    });

    test('código desconhecido continua com a frase honesta', () {
      expect(
        executionBlockerLabel('CODIGO_QUE_NAO_EXISTE'),
        'Execução indisponível no momento.',
      );
    });
  });

  group('vocabulário', () {
    test('toda ação publicada pelo backend tem rótulo', () {
      /// Se o backend ganhar uma ação nova, o enum cresce e este teste falha —
      /// que é o momento certo de decidir como ela se chama, e não quando o
      /// usuário vir um botão sem nome.
      for (final action in MobileFieldAction.values) {
        expect(
          fieldActionLabel(action),
          isNotNull,
          reason: 'ação sem rótulo: ${action.name}',
        );
      }
    });

    test('todo estado de prazo e tipo de trabalho tem rótulo', () {
      for (final state in MobileDueState.values) {
        expect(dueStateLabels[state], isNotNull, reason: state.name);
      }
      for (final kind in MobileWorkItemKind.values) {
        expect(workItemKindLabels[kind], isNotNull, reason: kind.name);
      }
    });

    test('nenhum rótulo é o nome do enum', () {
      final labels = [
        ...fieldActionLabels.values.map((entry) => entry.label),
        ...dueStateLabels.values.map((entry) => entry.label),
        ...workItemKindLabels.values.map((entry) => entry.label),
        ...professionalRoleLabels.values.map((entry) => entry.label),
      ];
      for (final label in labels) {
        expect(label, isNot(matches(RegExp(r'^[a-z]+([A-Z][a-z]+)+$'))));
        expect(label, isNot(contains('_')));
      }
    });
  });

  group('papéis profissionais', () {
    test('usa os termos oficiais do produto', () {
      expect(
        professionalRoleLabel(MobileProfessionalRole.fieldTechnician),
        'Técnico em Campo',
      );
      expect(
        professionalRoleLabel(MobileProfessionalRole.technicalResponsible),
        'Responsável Técnico',
      );
    });

    test(
      '"auxiliares técnico" é o termo do domínio, não um erro a corrigir',
      () {
        expect(auxiliaryTechniciansLabel, 'auxiliares técnico');
      },
    );
  });

  group('ações', () {
    test('preparar não promete executar', () {
      /// O rótulo precisa descrever o que acontece ao tocar. "Registrar
      /// evidência" abre a captura; não promete que o arquivo já subiu.
      expect(
        fieldActionLabel(MobileFieldAction.addEvidence)!.label,
        'Registrar evidência',
      );
      expect(
        fieldActionLabel(MobileFieldAction.openRoute)!.description,
        contains('mapa'),
      );
    });
  });

  group('erros', () {
    test('cada código tem frase de produto', () {
      expect(
        errorCodeLabel('FORBIDDEN'),
        'Você não possui permissão para realizar esta ação.',
      );
      expect(
        errorCodeLabel('CONFLICT'),
        'Os dados foram alterados. Atualize e tente novamente.',
      );
    });

    test('código desconhecido devolve null em vez do próprio código', () {
      /// Devolver 'ALGO_NOVO' empurraria para o usuário a tarefa de decifrar o
      /// sistema. `null` deixa quem chama escolher a mensagem do servidor.
      expect(errorCodeLabel('ALGO_NOVO'), isNull);
      expect(errorCodeLabel(null), isNull);
    });
  });
}
