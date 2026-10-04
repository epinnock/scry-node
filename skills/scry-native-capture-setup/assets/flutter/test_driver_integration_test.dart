// Host side of `flutter drive` (dev only): receives each screenshot the integration test takes and writes it to
// $SCRY_OUT/<id>.png. Without the onScreenshot callback the screenshots go nowhere. Nothing is uploaded.
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() => integrationDriver(
      onScreenshot: (name, bytes, [args]) async {
        final out = Platform.environment['SCRY_OUT'] ?? 'build/scry-it';
        Directory(out).createSync(recursive: true);
        File('$out/$name.png').writeAsBytesSync(bytes);
        return true;
      },
    );
