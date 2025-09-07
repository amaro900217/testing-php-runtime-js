{{-- resources/views/api/posts.blade.php --}}
@foreach($posts as $post)
  {{ $post->title }}
  {{ $post->content }}
  Creado: {{ $post->created_at->format('d/m/Y') }}
@endforeach
