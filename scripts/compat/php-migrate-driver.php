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
    foreach ($sources as $md) {
        try {
            $result = (new \MarkupCarve\Carve\Converter\MarkdownToCarve())->convertWithFidelityReport($md);
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
