// test/scry_fonts.dart - loads real fonts into `flutter test` (which draws every glyph as a black Ahem square by default)
// and refuses to continue when they did not load. Dev-only helper for test/scry_capture_test.dart.
//   1. Roboto and MaterialIcons from the Flutter SDK ($FLUTTER_ROOT/bin/cache/artifacts/material_fonts)
//   2. every family the app declares in its FontManifest.json (read through rootBundle)
// SCRY_NO_FONTS=1 skips the loading on purpose, to prove the guard (the run must then fail and write nothing).
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Thrown when the fonts needed for a readable capture are not available. The message is meant for a person.
class ScryFontsNotLoaded implements Exception {
  ScryFontsNotLoaded(this.problems);
  final List<String> problems;

  @override
  String toString() =>
      'scry capture: fonts did not load, so screenshots would show black Ahem blocks instead of text. '
      'No screenshots were written and no bundle was made.\n  - ${problems.join('\n  - ')}\n'
      'Fix: run with a complete Flutter SDK (FLUTTER_ROOT with bin/cache/artifacts/material_fonts) and declare your '
      "app's fonts under `fonts:` in pubspec.yaml.";
}

const _iconFamilies = {'MaterialIcons', 'CupertinoIcons'};

Future<void> loadScryFonts() async {
  if (Platform.environment['SCRY_NO_FONTS'] == '1') {
    await assertScryFontsReadable(const ['Roboto']);
    return;
  }
  final problems = <String>[];
  final families = <String>{'Roboto'};

  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null || root.isEmpty) {
    problems.add('FLUTTER_ROOT is not set, so the SDK fonts (Roboto, MaterialIcons) cannot be found');
  } else {
    final dir = '$root/bin/cache/artifacts/material_fonts';
    Future<void> sdkFont(String family, List<String> files) async {
      final loader = FontLoader(family);
      for (final f in files) {
        final file = File('$dir/$f');
        if (!file.existsSync()) {
          problems.add('SDK font file missing: $dir/$f');
          return;
        }
        loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
      }
      await loader.load();
    }

    await sdkFont('Roboto', ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Bold.ttf']);
    await sdkFont('MaterialIcons', ['MaterialIcons-Regular.otf']);
  }

  try {
    final manifest = jsonDecode(await rootBundle.loadString('FontManifest.json')) as List<dynamic>;
    for (final entry in manifest.cast<Map<String, dynamic>>()) {
      final family = entry['family'] as String;
      if (family.startsWith('packages/') || _iconFamilies.contains(family)) continue;
      final loader = FontLoader(family);
      for (final font in (entry['fonts'] as List<dynamic>).cast<Map<String, dynamic>>()) {
        loader.addFont(rootBundle.load(font['asset'] as String));
      }
      await loader.load();
      families.add(family);
    }
  } on Object catch (e) {
    problems.add("the app's FontManifest.json could not be read ($e)");
  }

  if (problems.isNotEmpty) throw ScryFontsNotLoaded(problems);
  await assertScryFontsReadable(families.toList());
}

/// Ahem draws every glyph as a 1 em square, so "iiii" and "WWWW" measure the same. A real font does not.
Future<void> assertScryFontsReadable(List<String> families) async {
  final placeholders = <String>[];
  for (final family in families) {
    double width(String text) {
      final p = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(fontFamily: family, fontSize: 40),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      return p.width;
    }

    if ((width('iiii') - width('WWWW')).abs() < 0.5) placeholders.add('$family renders as placeholder blocks (Ahem)');
  }
  if (placeholders.isNotEmpty) throw ScryFontsNotLoaded(placeholders);
}
