/// Public, additive contracts for `/api/v1/rvt`.
///
/// RVT configuration, occurrence, execution and artifact are different
/// identities. Mobile clients must use `allowedActions` and
/// `executionEligibility`; they never rebuild authorization locally.
enum RvtVisitType { weekly, semiannual }

enum RvtScheduleMode { recurring, oneTime }

enum RvtDueState { upcoming, dueToday, overdue }

class RvtOccurrenceContract {
  const RvtOccurrenceContract({
    required this.id,
    required this.configurationId,
    required this.sequenceNumber,
    required this.sequence,
    required this.status,
    required this.dueState,
    required this.allowedActions,
    this.scheduledFor,
    this.executionId,
  });
  final String id;
  final String configurationId;
  final int sequenceNumber;
  final String sequence;
  final String status;
  final RvtDueState dueState;
  final DateTime? scheduledFor;
  final String? executionId;
  final List<String> allowedActions;
}

class RvtExecutionEligibilityContract {
  const RvtExecutionEligibilityContract({
    required this.eligible,
    required this.blockers,
  });
  final bool eligible;
  final List<String> blockers;
}
