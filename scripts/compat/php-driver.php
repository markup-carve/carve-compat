<?php

declare(strict_types=1);

$root = getenv('CARVE_PHP_ROOT') ?: __DIR__ . '/../../.cache/engines/php';
spl_autoload_register(static function (string $class) use ($root): void {
    $prefix = 'MarkupCarve\\Carve\\';
    if (str_starts_with($class, $prefix)) {
        $path = $root . '/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($path)) require $path;
    }
});

use MarkupCarve\Carve\Ast\AstCodec;
use MarkupCarve\Carve\Parser\BlockParser;
use MarkupCarve\Carve\Renderer\CarveRenderer;
use MarkupCarve\Carve\Renderer\HtmlRenderer;

try {
    $request = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    $codec = new AstCodec();
    $parser = new BlockParser();
    $doc = $codec->decode($request['ast']);
    $decoded = $codec->encode($doc);
    $canonical = (new CarveRenderer())->render($doc);
    $html = (new HtmlRenderer())->render($doc);
    echo json_encode([
        'decodedAst' => $decoded,
        'canonical' => $canonical,
        'reparsedAst' => $codec->encode($parser->parse($canonical)),
        'html' => $html,
        'parsedAst' => $codec->encode($parser->parse($request['carve'])),
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
