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

try {
    $sources = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    $results = [];
    if (!is_array($sources) || !array_is_list($sources)) {
        throw new InvalidArgumentException('Expected a JSON array of importer sources');
    }
    foreach ($sources as $entry) {
        try {
            $format = is_string($entry) ? 'markdown' : ($entry['format'] ?? null);
            $source = is_string($entry) ? $entry : ($entry['source'] ?? null);
            if (!is_string($source)) throw new InvalidArgumentException('Expected a string importer source');
            $converter = match ($format) {
                'markdown' => new \MarkupCarve\Carve\Converter\MarkdownToCarve(),
                'djot' => new \MarkupCarve\Carve\Converter\DjotToCarve(),
                'html' => new \MarkupCarve\Carve\Converter\HtmlToCarve(),
                default => throw new InvalidArgumentException('Unknown importer format'),
            };
            $result = $converter->convertWithFidelityReport($source);
            $results[] = ['value' => $result->value, 'report' => $result->report()];
        } catch (Throwable $error) {
            $results[] = ['error' => $error->getMessage()];
        }
    }
    echo json_encode($results, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
