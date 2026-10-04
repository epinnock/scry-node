// The registry (integration_test/scry/screens.dart) and scripts/screens.json describe the same screens.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../integration_test/scry/screens.dart';

void main() {
  test('screens.json and the registry list the same screens', () {
    final json = (jsonDecode(File('scripts/screens.json').readAsStringSync()) as List<dynamic>)
        .cast<Map<String, dynamic>>();
    expect(json.map((e) => e['id']).toList(), scryScreens.map((s) => s.id).toList());
    for (var i = 0; i < json.length; i++) {
      expect(json[i]['name'], scryScreens[i].name, reason: json[i]['id'] as String);
      expect(json[i]['file'], scryScreens[i].file, reason: json[i]['id'] as String);
      expect(json[i]['line'], scryScreens[i].line, reason: json[i]['id'] as String);
      expect(File(json[i]['file'] as String).existsSync(), isTrue, reason: '${json[i]['file']} must exist');
    }
  });
}
